import { createHash, createHmac } from "node:crypto";

type SigningRequest = {
  endpoint: string;
  headers: Record<string, string>;
};

function iso8601Basic(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function hmac(key: string | Buffer, value: string, encoding: "hex" | "buffer" = "buffer"): string | Buffer {
  const digest = createHmac("sha256", key).update(value, "utf8").digest();
  return encoding === "hex" ? digest.toString("hex") : digest;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function encodeObjectKey(value: string): string {
  return value.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

function canonicalQuery(value: string): string {
  return Array.from(new URLSearchParams(value).entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
    .map(([key, entry]) => `${encodeURIComponent(key)}=${encodeURIComponent(entry)}`)
    .join("&");
}

function requirePresignExpiry(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > 604_800) {
    throw new Error("Presigned URL expiry must be between 1 second and 7 days.");
  }
  return value;
}

export function defaultS3Endpoint(region: string): string {
  return `https://s3.${region}.amazonaws.com`;
}

export function normalizeS3Endpoint(value: string, region: string): string {
  const candidate = value.trim() || defaultS3Endpoint(region);
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("S3 endpoint must be a valid HTTPS origin.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("S3 endpoint must be an HTTPS origin without a path, query, or credentials.");
  }
  return url.origin;
}

export function createAliyunOssV4Request(input: {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  method: "DELETE" | "GET" | "PUT";
  objectKey?: string;
  query?: string;
  contentType?: string;
  contentDisposition?: string;
  now?: Date;
}): SigningRequest {
  const date = iso8601Basic(input.now ?? new Date());
  const day = date.slice(0, 8);
  const host = `${input.bucket}.oss-${input.region}.aliyuncs.com`;
  const requestPath = input.objectKey ? `/${encodeObjectKey(input.objectKey)}` : "/";
  // OSS V4 keeps the Bucket in the canonical resource even when the actual
  // request uses a virtual-hosted Bucket endpoint.
  const canonicalPath = `/${encodeURIComponent(input.bucket)}${requestPath}`;
  const query = canonicalQuery(input.query ?? "");
  const canonicalHeaders = [
    ...(input.contentDisposition ? [`content-disposition:${input.contentDisposition.trim()}`] : []),
    ...(input.contentType ? [`content-type:${input.contentType.trim()}`] : []),
    `host:${host}`,
    "x-oss-content-sha256:UNSIGNED-PAYLOAD",
    `x-oss-date:${date}`,
  ].sort().join("\n") + "\n";
  const additionalHeaders = [
    ...(input.contentDisposition ? ["content-disposition"] : []),
    "host",
  ].sort().join(";");
  const canonicalRequest = [
    input.method,
    canonicalPath,
    query,
    canonicalHeaders,
    additionalHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const scope = `${day}/${input.region}/oss/aliyun_v4_request`;
  const stringToSign = ["OSS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`aliyun_v4${input.accessKeySecret}`, day);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, "oss");
  const signingKey = hmac(serviceKey, "aliyun_v4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  const authorization = [
    `Credential=${input.accessKeyId}/${scope}`,
    `AdditionalHeaders=${additionalHeaders}`,
    `Signature=${signature}`,
  ].join(",");

  return {
    endpoint: `https://${host}${requestPath}${query ? `?${query}` : ""}`,
    headers: {
      Authorization: `OSS4-HMAC-SHA256 ${authorization}`,
      "x-oss-content-sha256": "UNSIGNED-PAYLOAD",
      "x-oss-date": date,
      ...(input.contentType ? { "Content-Type": input.contentType } : {}),
      ...(input.contentDisposition ? { "Content-Disposition": input.contentDisposition } : {}),
    },
  };
}

/**
 * A temporary GET URL is the only credential that leaves the local server for
 * an external media provider. The object itself remains private in the bucket.
 */
export function createAliyunOssV4PresignedGetUrl(input: {
  accessKeyId: string;
  accessKeySecret: string;
  bucket: string;
  region: string;
  objectKey: string;
  expiresInSeconds: number;
  now?: Date;
}): string {
  const date = iso8601Basic(input.now ?? new Date());
  const day = date.slice(0, 8);
  const host = `${input.bucket}.oss-${input.region}.aliyuncs.com`;
  const requestPath = `/${encodeObjectKey(input.objectKey)}`;
  const canonicalPath = `/${encodeURIComponent(input.bucket)}${requestPath}`;
  const scope = `${day}/${input.region}/oss/aliyun_v4_request`;
  const query = canonicalQuery(new URLSearchParams({
    "x-oss-additional-headers": "host",
    "x-oss-credential": `${input.accessKeyId}/${scope}`,
    "x-oss-date": date,
    "x-oss-expires": String(requirePresignExpiry(input.expiresInSeconds)),
    "x-oss-signature-version": "OSS4-HMAC-SHA256",
  }).toString());
  const canonicalRequest = [
    "GET",
    canonicalPath,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["OSS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`aliyun_v4${input.accessKeySecret}`, day);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, "oss");
  const signingKey = hmac(serviceKey, "aliyun_v4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  return `https://${host}${requestPath}?${query}&x-oss-signature=${signature}`;
}

export function createS3V4Request(input: {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint?: string;
  method: "DELETE" | "GET" | "PUT";
  objectKey?: string;
  query?: string;
  payloadHash?: string;
  contentType?: string;
  contentDisposition?: string;
  now?: Date;
}): SigningRequest {
  const origin = normalizeS3Endpoint(input.endpoint ?? "", input.region);
  const date = iso8601Basic(input.now ?? new Date());
  const day = date.slice(0, 8);
  const url = new URL(origin);
  const host = url.host;
  const path = `/${encodeURIComponent(input.bucket)}${input.objectKey ? `/${encodeObjectKey(input.objectKey)}` : ""}`;
  const query = canonicalQuery(input.query ?? "");
  const payloadHash = input.payloadHash ?? sha256("");
  const canonicalHeaderEntries = [
    ...(input.contentDisposition ? [`content-disposition:${input.contentDisposition.trim()}`] : []),
    ...(input.contentType ? [`content-type:${input.contentType.trim()}`] : []),
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${date}`,
  ].sort();
  const canonicalHeaders = `${canonicalHeaderEntries.join("\n")}\n`;
  const signedHeaders = canonicalHeaderEntries.map((entry) => entry.slice(0, entry.indexOf(":"))).join(";");
  const canonicalRequest = [input.method, path, query, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${input.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");

  return {
    endpoint: `${origin}${path}${query ? `?${query}` : ""}`,
    headers: {
      Authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": date,
      ...(input.contentType ? { "Content-Type": input.contentType } : {}),
      ...(input.contentDisposition ? { "Content-Disposition": input.contentDisposition } : {}),
    },
  };
}

export function createS3V4PresignedGetUrl(input: {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  endpoint?: string;
  objectKey: string;
  expiresInSeconds: number;
  now?: Date;
}): string {
  const origin = normalizeS3Endpoint(input.endpoint ?? "", input.region);
  const date = iso8601Basic(input.now ?? new Date());
  const day = date.slice(0, 8);
  const host = new URL(origin).host;
  const path = `/${encodeURIComponent(input.bucket)}/${encodeObjectKey(input.objectKey)}`;
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const query = canonicalQuery(new URLSearchParams({
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${input.accessKeyId}/${scope}`,
    "X-Amz-Date": date,
    "X-Amz-Expires": String(requirePresignExpiry(input.expiresInSeconds)),
    "X-Amz-SignedHeaders": "host",
  }).toString());
  const canonicalRequest = [
    "GET",
    path,
    query,
    `host:${host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${input.secretAccessKey}`, day);
  const regionKey = hmac(dateKey, input.region);
  const serviceKey = hmac(regionKey, "s3");
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  return `${origin}${path}?${query}&X-Amz-Signature=${signature}`;
}
