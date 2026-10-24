// Shared by the standalone plugin UI and its local service.
export type WorkbenchRole = "annotator" | "reviewer";
export type ProjectReview = {
  status: "pending" | "approved" | "rejected";
  comment: string;
  reviewedAt: string | null;
  revision: number | null;
};

export type MediaSource = {
  title: string;
  author: string;
  url: string;
  license: string;
  licenseUrl: string;
  changes: string;
};
