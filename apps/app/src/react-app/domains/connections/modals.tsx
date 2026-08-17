/** @jsxImportSource react */
import type { McpDirectoryInfo } from "../../../app/constants";
import type { iPolloWorkServerClient } from "../../../app/lib/ipollowork-server";

import { McpAuthModal } from "./mcp-auth-modal";

export type ConnectionsModalsState = {
  mcpAuthModalOpen: boolean;
  mcpAuthEntry: McpDirectoryInfo | null;
};

export type ConnectionsModalsProps = {
  serverClient: iPolloWorkServerClient | null;
  workspaceId: string | null;
  modalState: ConnectionsModalsState;
  onCloseMcpAuthModal: () => void;
  onCompleteMcpAuthModal: () => void | Promise<void>;
};

export default function ConnectionsModals(props: ConnectionsModalsProps) {
  return (
    <McpAuthModal
      open={props.modalState.mcpAuthModalOpen}
      serverClient={props.serverClient}
      workspaceId={props.workspaceId}
      entry={props.modalState.mcpAuthEntry}
      onClose={props.onCloseMcpAuthModal}
      onComplete={props.onCompleteMcpAuthModal}
    />
  );
}
