export type RemoteWorkspaceInput = {
  ipolloworkHostUrl?: string | null;
  ipolloworkToken?: string | null;
  ipolloworkClientToken?: string | null;
  ipolloworkHostToken?: string | null;
  directory?: string | null;
  displayName?: string | null;
  closeModal?: boolean;
};

export type CreateRemoteWorkspaceModalProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: (input: {
    ipolloworkHostUrl?: string | null;
    ipolloworkToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  }) => void;
  initialValues?: {
    ipolloworkHostUrl?: string | null;
    ipolloworkToken?: string | null;
    directory?: string | null;
    displayName?: string | null;
  };
  submitting?: boolean;
  error?: string | null;
  showClose?: boolean;
  title?: string;
  subtitle?: string;
  confirmLabel?: string;
};
