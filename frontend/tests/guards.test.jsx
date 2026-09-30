import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { vi } from 'vitest'

const state = { user: null, loading: false }
vi.mock('../src/app/AuthContext.jsx', () => ({ useAuth: () => state }))

import { RequireAuth, RequireRole } from '../src/app/guards.jsx'

const setup = (path) => render(
  <MemoryRouter initialEntries={[path]}>
    <Routes>
      <Route path="/login" element={<p>login page</p>} />
      <Route path="/student" element={<p>student home</p>} />
      <Route element={<RequireAuth />}>
        <Route element={<RequireRole role="lecturer" />}>
          <Route path="/lecturer" element={<p>lecturer home</p>} />
        </Route>
      </Route>
    </Routes>
  </MemoryRouter>,
)

test('unauthenticated users are sent to login', () => {
  state.user = null
  setup('/lecturer')
  expect(screen.getByText('login page')).toBeInTheDocument()
})

test('student is redirected away from lecturer area', () => {
  state.user = { role: 'student' }
  setup('/lecturer')
  expect(screen.getByText('student home')).toBeInTheDocument()
})

test('lecturer can enter lecturer area', () => {
  state.user = { role: 'lecturer' }
  setup('/lecturer')
  expect(screen.getByText('lecturer home')).toBeInTheDocument()
})
