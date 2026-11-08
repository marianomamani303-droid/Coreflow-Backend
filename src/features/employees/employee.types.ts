export interface AddMemberInput {
  email: string
  role: 'admin' | 'employee'
  department: string | null
  jobTitle: string | null
}
export interface UpdateMemberInput {
  role: 'admin' | 'employee'
  status: 'active' | 'suspended'
  department: string | null
  jobTitle: string | null
}
