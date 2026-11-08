export type CompanyRole = 'owner' | 'admin' | 'employee'

export interface UserCompany {
  id: string
  currency: string
  hasLogo: boolean
  logoVersion: string
  name: string
  sector: string | null
  role: CompanyRole
  memberCount: number
  createdAt: string
}

export interface CreateCompanyInput {
  name: string
  sector: string | null
}
