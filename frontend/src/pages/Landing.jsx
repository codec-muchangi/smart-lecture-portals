import { Link } from 'react-router-dom'

export default function Landing() {
  return (
    <main style={{ padding: '3rem', maxWidth: 720, margin: '0 auto' }}>
      <h1>Smart Lecture Portal</h1>
      <p>Course materials, assignments, attendance and marks in one place for students and lecturers.</p>
      <Link to="/login">Sign in</Link>
    </main>
  )
}
