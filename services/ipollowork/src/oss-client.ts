/** OSS clients use either centrally stored keys or the deployment's explicit ECS role. */
import OSS from "ali-oss";
import { ECSRAMRoleCredentialsProvider } from "@alicloud/credentials";
import { ServiceError } from "./errors.js";

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
