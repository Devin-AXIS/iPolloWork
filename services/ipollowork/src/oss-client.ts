/** OSS clients use either centrally stored keys or the deployment's explicit ECS role. */
import OSS from "ali-oss";
import { ECSRAMRoleCredentialsProvider } from "@alicloud/credentials";
import { ServiceError } from "./errors.js";

type Version = { name: string; versionId: string };
type VersionPage = { objects: Version[]; deleteMarker: Version[]; isTruncated: boolean; nextKeyMarker: string; nextVersionIdMarker: string };

/** The published Node SDK implements this operation ahead of its community types. */
interface VersionListing {
  listObjectVersions(query: { prefix: string; keyMarker?: string; versionIdMarker?: string }): Promise<VersionPage>;
}

export async function deleteOssObject(client: OSS, key: string): Promise<void> {
  const result = await client.delete(key);
  const headers = result.res?.headers as Record<string, unknown> | undefined;
  if (String(headers?.["x-oss-delete-marker"]) !== "true") return;

  const versions = client as OSS & VersionListing;
  const objects: Version[] = [], markers: Version[] = [];
  let query: Parameters<VersionListing["listObjectVersions"]>[0] = { prefix: key };
  for (;;) {
    const page = await versions.listObjectVersions(query);
    objects.push(...page.objects.filter(item => item.name === key));
    markers.push(...page.deleteMarker.filter(item => item.name === key));
    if (!page.isTruncated || page.nextKeyMarker !== key) break;
    if (query.keyMarker === page.nextKeyMarker && query.versionIdMarker === page.nextVersionIdMarker)
      throw new Error("OSS repeated the object version cursor");
    query = { prefix: key, keyMarker: page.nextKeyMarker, versionIdMarker: page.nextVersionIdMarker };
  }
  // Delete the markers last so a partially failed cleanup never reveals an older version.
  for (const { versionId } of [...objects, ...markers]) {
    const options: OSS.RequestOptions & { versionId: string } = { versionId };
    await client.delete(key, options);
  }
  const remaining = await versions.listObjectVersions({ prefix: key });
  if ([...remaining.objects, ...remaining.deleteMarker].some(item => item.name === key))
    throw new Error("OSS still has a version of the deleted object");
}

/** The official provider owns STS renewal; downloads always use the public OSS endpoint. */
export class OssClients {
  private readonly credentials?: ECSRAMRoleCredentialsProvider;

  constructor(roleName?: string, private readonly internal = false) {
    if (roleName)
      this.credentials = ECSRAMRoleCredentialsProvider.builder()
        .withRoleName(roleName)
        .withDisableIMDSv1(true)
        .withAsyncCredentialUpdateEnabled(false)
        .build();
  }

  /** Release the provider with its service. */
  close(): void {
    this.credentials?.close();
  }

  /** Resolve credentials before I/O; a failed role never falls back to stored keys. */
  async create(setting: Record<string, string>, publicEndpoint = false): Promise<OSS> {
    if (!setting.region || !setting.bucket)
      throw new ServiceError("OSS_NOT_CONFIGURED", 503, "请先配置阿里云 OSS");
    const credentials = this.credentials;
    const roleKeys = async () => {
      try {
        const value = await credentials!.getCredentials();
        return {
          accessKeyId: value.accessKeyId,
          accessKeySecret: value.accessKeySecret,
          stsToken: value.securityToken,
        };
      } catch (error) {
        throw new ServiceError("OSS_CREDENTIAL_UNAVAILABLE", 503, "存储授权暂不可用，请检查服务器的 OSS 角色", { cause: error });
      }
    };
    if (!credentials && (!setting.accessKeyId || !setting.accessKeySecret))
      throw new ServiceError("OSS_NOT_CONFIGURED", 503, "请先配置阿里云 OSS");
    return new OSS({
      region: setting.region,
      bucket: setting.bucket,
      ...(credentials ? await roleKeys() : {
        accessKeyId: setting.accessKeyId!,
        accessKeySecret: setting.accessKeySecret!,
      }),
      ...(credentials ? { refreshSTSToken: roleKeys, refreshSTSTokenInterval: 0 } : {}),
      internal: this.internal && !publicEndpoint,
      secure: true,
    });
  }
}
