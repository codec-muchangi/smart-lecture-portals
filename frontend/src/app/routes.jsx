import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './AuthContext.jsx'
import { RequireAuth, RequireRole } from './guards.jsx'
import AppShell from '../layouts/AppShell.jsx'
import Landing from '../pages/Landing.jsx'
import Login from '../pages/auth/Login.jsx'
import NotFound from '../pages/NotFound.jsx'
import Placeholder from '../pages/Placeholder.jsx'

const P = (title, phase) => <Placeholder title={title} phase={phase} />

const STUDENT_ROUTES = [
  ['', 'Student Dashboard', 'Phase 8'], ['courses', 'My Courses', 'Phase 2'],
  ['courses/:courseId', 'Course Details', 'Phase 2'], ['courses/:courseId/materials', 'Materials', 'Phase 3'],
  ['courses/:courseId/assignments', 'Assignments', 'Phase 4'], ['assignments/:assignmentId', 'Assignment Submission', 'Phase 4'],
  ['attendance', 'Attendance', 'Phase 6'], ['marks', 'Marks / Results', 'Phase 5'],
  ['announcements', 'Announcements', 'Phase 7'], ['notifications', 'Notifications', 'Phase 7'],
  ['timetable', 'Timetable', 'Phase 8'], ['profile', 'Profile', 'Phase 1'], ['settings', 'Settings', 'Phase 1'],
]
const LECTURER_ROUTES = [
  ['', 'Lecturer Dashboard', 'Phase 8'], ['courses', 'My Courses', 'Phase 2'],
  ['courses/:courseId', 'Course Details', 'Phase 2'], ['courses/:courseId/students', 'Students', 'Phase 2'],
  ['courses/:courseId/materials', 'Materials Management', 'Phase 3'], ['courses/:courseId/assignments', 'Assignment Management', 'Phase 4'],
  ['assignments/:assignmentId/submissions', 'Submission Review', 'Phase 4'], ['courses/:courseId/attendance', 'Attendance Management', 'Phase 6'],
  ['courses/:courseId/marks', 'Marks Management', 'Phase 5'], ['courses/:courseId/announcements', 'Announcements', 'Phase 7'],
  ['courses/:courseId/reports', 'Reports', 'Phase 8'], ['notifications', 'Notifications', 'Phase 7'],
  ['timetable', 'Timetable', 'Phase 8'], ['profile', 'Profile', 'Phase 1'], ['settings', 'Settings', 'Phase 1'],
]

function Home() {
  const { user } = useAuth()
  return user ? <Navigate to={`/${user.role}`} replace /> : <Landing />
}

const roleRoutes = (role, list) => (
  <Route element={<RequireRole role={role} />}>
    <Route path={`/${role}`} element={<AppShell role={role} />}>
      {list.map(([path, title, phase]) => (
        path === '' ? <Route key="index" index element={P(title, phase)} /> : <Route key={path} path={path} element={P(title, phase)} />
      ))}
    </Route>
  </Route>
)

export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        {roleRoutes('student', STUDENT_ROUTES)}
        {roleRoutes('lecturer', LECTURER_ROUTES)}
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}
