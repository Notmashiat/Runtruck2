// GET /api/v1/me — who is signed in, for which organization, and what they may do.
// Permissions are sent so the web app can hide controls the API would refuse;
// the API remains the only authority (architecture §2 Rule 2).

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  memberNumber: string;
  title: string;
}

export interface SessionOrganization {
  id: string;
  name: string;
  shortName: string;
  companyNumber: string;
  timezone: string;
}

export interface MeResponse {
  user: SessionUser;
  organization: SessionOrganization;
  permissions: string[];
  // The organization's business date (YYYY-MM-DD), pinned by DEMO_TODAY in demo environments.
  today: string;
}
