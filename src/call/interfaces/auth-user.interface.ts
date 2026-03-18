export interface AuthUser {
  sub: string;
  roles: string[];
  fullName?: string;
  email?: string;
}