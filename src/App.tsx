import { lazy, Suspense, useState } from 'react'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { WorkSessionProvider, useWorkSession } from './contexts/WorkSessionContext'
import LoginPage from './components/auth/LoginPage'
import ChangePasswordModal from './components/auth/ChangePasswordModal'
import ResetPasswordPage from './components/auth/ResetPasswordPage'
import ClientRegistrationPage from './components/auth/ClientRegistrationPage'
import TeamRegistrationPage from './components/auth/TeamRegistrationPage'
import CheckInModal from './components/shared/CheckInModal'
import OvertimeModal from './components/shared/OvertimeModal'
import MissingDatesModal from './components/shared/MissingDatesModal'
import AppErrorBoundary from './components/shared/AppErrorBoundary'
import RequiredTeamProfileModal, { missingRequiredProfileData, REQUIRED_PROFILE_START } from './components/shared/RequiredTeamProfileModal'
import BirthdayCelebration from './components/shared/BirthdayCelebration'
import './index.css'

const AdminDashboard = lazy(() => import('./components/admin/AdminDashboard'))
const TeamDashboard = lazy(() => import('./components/team/TeamDashboard'))
const ClientPortal = lazy(() => import('./components/client/ClientPortal'))

function AppLoading() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 to-red-700 flex items-center justify-center">
      <div className="text-white text-center">
        <div className="w-12 h-12 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
        <p className="text-sm opacity-70">Cargando...</p>
      </div>
    </div>
  )
}

function AppContent() {
  const { session, user, loading, isPasswordRecovery, unauthorizedEmail, deactivatedEmail, licenseSuspended } = useAuth()
  const { needsCheckIn, showOvertimeModal, currentSession } = useWorkSession()
  const [profileGateCompleted, setProfileGateCompleted] = useState(false)
  const inviteToken = new URLSearchParams(window.location.search).get('invite')
  const teamInviteToken = new URLSearchParams(window.location.search).get('team_invite')

  if (loading) return <AppLoading />

  if (isPasswordRecovery) return <ResetPasswordPage />

  if (!session || !user) {
    if (inviteToken) return <ClientRegistrationPage inviteToken={inviteToken} />
    if (teamInviteToken) return <TeamRegistrationPage inviteToken={teamInviteToken} />
    return <LoginPage unauthorizedEmail={unauthorizedEmail} deactivatedEmail={deactivatedEmail} licenseSuspended={licenseSuspended} />
  }

  if (user.must_change_password) return <ChangePasswordModal />

  const metadata = session.user.user_metadata || {}
  const mustCompleteTeamProfile = user.role === 'team' && new Date() >= REQUIRED_PROFILE_START && Boolean(currentSession) && !profileGateCompleted && missingRequiredProfileData(user.full_name, metadata)

  return (
    <div className="min-h-screen bg-gray-50">
      <Suspense fallback={<AppLoading />}>
        <main>
          {user.role === 'admin' && <AdminDashboard />}
          {user.role === 'team' && <TeamDashboard />}
          {user.role === 'client' && <ClientPortal />}
        </main>
      </Suspense>

      {/* Modales del reloj checador (equipo y admin) */}
      {user.role !== 'client' && needsCheckIn && <CheckInModal />}
      {user.role !== 'client' && showOvertimeModal && <OvertimeModal />}
      {user.role === 'team' && <MissingDatesModal />}
      {mustCompleteTeamProfile && <RequiredTeamProfileModal onComplete={() => setProfileGateCompleted(true)} />}
      {user.role === 'team' && !mustCompleteTeamProfile && <BirthdayCelebration />}
    </div>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AuthProvider>
        <WorkSessionProvider>
          <AppContent />
        </WorkSessionProvider>
      </AuthProvider>
    </AppErrorBoundary>
  )
}
