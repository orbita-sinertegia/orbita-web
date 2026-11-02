export type Role = 'admin' | 'team' | 'client'

export interface WorkDaySchedule { enabled: boolean; start: number; end: number }
export type WorkSchedule = Record<string, WorkDaySchedule>

export interface ChatRoom {
  id: string
  type: 'team' | 'client'
  client_id?: string
  name: string
  created_at: string
}

export interface ChatMessage {
  id: string
  room_id: string
  sender_id: string
  content: string
  created_at: string
  converted_to_task: boolean
  task_id?: string
  file_url?: string
  file_type?: string
  file_name?: string
  deleted_for_everyone?: boolean
  deleted_for?: string[]
  reply_to_id?: string
  is_pinned?: boolean
  reactions?: Record<string, string[]>
  read_by?: string[]
  sender?: User
}


export type Priority = 'critica' | 'alta' | 'media' | 'baja'

export type TaskStatus = 'pendiente' | 'en_progreso' | 'completada' | 'bloqueada'

export type Department =
  | 'edicion'
  | 'grabacion'
  | 'diseno'
  | 'copy'
  | 'webmaster'
  | 'trafficker'
  | 'lider'
  | 'cliente'

export interface User {
  id: string
  email: string
  full_name: string
  role: Role
  department?: Department
  avatar_url?: string
  must_change_password?: boolean
  created_at: string
  work_start?: number
  work_end?: number
  work_schedule?: WorkSchedule
  active?: boolean
  is_super_admin?: boolean
  directory_hidden?: boolean
}

export interface Client {
  id: string
  name: string
  company: string
  notes?: string
  user_id?: string
  cover_image?: string
  avatar_url?: string
  active?: boolean
  directory_hidden?: boolean
  created_at: string
}

export interface Project {
  id: string
  client_id: string
  name: string
  description?: string
  status: 'activo' | 'pausado' | 'completado'
  recording_mode?: 'oficina' | 'remota'
  launch_date?: string
  launch_date_original?: string
  created_at: string
  source_template_id?: string
  client?: Client
}

export interface TaskLink {
  id: string
  task_id: string
  label: string
  url: string
}

export interface Comment {
  id: string
  task_id: string
  user_id: string
  content: string
  image_url?: string
  created_at: string
  user?: User
}

export interface Subtask {
  id: string
  task_id: string
  title: string
  completed: boolean
  position: number
  created_at: string
}

export interface TimeEntry {
  id: string
  task_id: string
  user_id: string
  started_at: string
  ended_at?: string
  minutes?: number
  note?: string
  created_at: string
  user?: User
}

export interface Task {
  id: string
  project_id: string
  title: string
  description?: string
  assigned_to: string
  department: Department
  status: TaskStatus
  priority: Priority
  source_template_id?: string
  source_template_key?: string
  start_date?: string
  needed_date?: string
  commitment_date?: string
  completion_date?: string
  reviewer_id?: string
  approver_id?: string
  approver_ids?: string[]
  review_status?: 'pendiente_revision' | 'pendiente_trafficker' | 'en_revision' | 'aprobada' | 'cambios_solicitados'
  client_approval?: 'aprobada' | 'cambios_solicitados'
  change_count?: number
  depends_on_task_id?: string
  phase?: string | null
  delay_responsible?: 'cliente' | 'agencia'
  delay_days?: number
  delay_reason?: string
  delay_marked_at?: string
  delay_marked_by?: string
  archived_at?: string | null
  archived_by?: string | null
  archive_reason?: string | null
  created_by: string
  created_at: string
  updated_at: string
  project?: Project
  assignee?: User
  links?: TaskLink[]
  comments?: Comment[]
}
