type ModelCapabilitiesInput = {
  capabilities?: {
    input?: {
      image?: boolean;
    };
  };
} | null | undefined;

export function modelSupportsVision(model: ModelCapabilitiesInput): boolean {
  return model?.capabilities?.input?.image === true;
}
