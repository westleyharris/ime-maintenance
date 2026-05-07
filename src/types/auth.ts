export type UserRole = 'ime_admin' | 'company_admin' | 'plant_manager';

export interface Profile {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  company_id: string | null;
  created_at: string;
}
