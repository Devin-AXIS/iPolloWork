import type { EnterpriseConnection } from "./enterprise-connections";
import { publishEnterpriseTemplate } from "./enterprise-connections";

export type TemplatePublishDestination = {
  id: `enterprise:${string}`;
  kind: "enterprise";
  name: string;
  connection: EnterpriseConnection;
};

export function enterpriseTemplateDestination(connection: EnterpriseConnection): TemplatePublishDestination {
  return { id: `enterprise:${connection.id}`, kind: "enterprise", name: connection.shortName, connection };
}

export async function publishTemplatePackage(destination: TemplatePublishDestination, file: File) {
  switch (destination.kind) {
    case "enterprise":
      return publishEnterpriseTemplate(destination.connection, file);
  }
}
