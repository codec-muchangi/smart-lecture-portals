import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from 'vitest'

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }))
vi.mock('../src/services/apiClient.js', () => ({ api: apiMock }))

import LecturerMaterials from '../src/pages/lecturer/LecturerMaterials.jsx'

const DAY = 24 * 3_600_000
const at = (ms) => new Date(Date.now() + ms).toISOString()

const COURSES = {
  items: [
    { id: 'c1', course_code: 'CS401', course_name: 'Advanced Software Engineering', status: 'active' },
    { id: 'c2', course_code: 'CS402', course_name: 'Cloud Architecture', status: 'active' },
  ],
  total: 2,
}

const material = (id, courseId, extra = {}) => ({
  id,
  course_id: courseId,
  title: `Material ${id}`,
  description: '',
  category: 'slides',
  file_name: `${id}.pdf`,
  mime_type: 'application/pdf',
  file_size: 1_048_576,
  published: true,
  uploader_name: 'Prof. Sterling',
  created_at: at(-DAY),
  ...extra,
})

let store

function seed() {
  store = {
    c1: [
      material('m1', 'c1', { title: 'Zero Trust Security', file_size: 4_800_000, created_at: at(-2 * DAY) }),
      material('m2', 'c1', { title: 'Docker Lab', category: 'lab', file_name: 'docker-lab.zip', mime_type: 'application/zip', file_size: 12_400_000, published: false, description: 'Compose scaffolding', created_at: at(-5 * DAY) }),
    ],
    c2: [material('m3', 'c2', { title: 'Cloud Slides', file_name: 'cloud.pptx', created_at: at(-3 * DAY), file_size: 2_000_000 })],
  }
}

function install(overrides = {}) {
  apiMock.mockImplementation(async (path, options = {}) => {
    if (path in overrides) {
      const value = overrides[path]
      if (value instanceof Error) throw value
      return value
    }
    if (path === '/courses?page_size=100') return COURSES
    const list = path.match(/^\/courses\/(c\d)\/materials\?page_size=100$/)
    if (list) return { items: store[list[1]], total: store[list[1]].length }
    const item = path.match(/^\/materials\/(m\d+)$/)
    if (item && options.method === 'PATCH') {
      for (const rows of Object.values(store)) {
        const row = rows.find((entry) => entry.id === item[1])
        if (row) Object.assign(row, options.body)
      }
      return {}
    }
    if (item && options.method === 'DELETE') {
      for (const key of Object.keys(store)) store[key] = store[key].filter((entry) => entry.id !== item[1])
      return null
    }
    if (path === '/courses/c1/materials' && options.method === 'POST') {
      store.c1 = [material('m9', 'c1', { title: options.form.get('title') }), ...store.c1]
      return {}
    }
    throw new Error(`unexpected request: ${path}`)
  })
}

function renderAt(url) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/lecturer/materials" element={<LecturerMaterials />} />
          <Route path="/lecturer/courses/:courseId/materials" element={<LecturerMaterials />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const rowTitles = () => screen.queryAllByRole('heading', { level: 3 }).map((node) => node.textContent).filter((text) => text !== 'Course document inventory')

beforeEach(() => {
  apiMock.mockReset()
  seed()
})

describe('inventory', () => {
  test('lists materials from every course with a real summary', async () => {
    install()
    renderAt('/lecturer/materials')
    expect(await screen.findByText('Zero Trust Security')).toBeInTheDocument()
    expect(screen.getByText('Docker Lab')).toBeInTheDocument()
    expect(screen.getByText('Cloud Slides')).toBeInTheDocument()
    expect(screen.getByText('3 files')).toBeInTheDocument()
    expect(screen.getByText('18.3 MB')).toBeInTheDocument()
    expect(screen.getByText('2 published')).toBeInTheDocument()
    expect(screen.getByText('1 hidden')).toBeInTheDocument()
    expect(screen.getByText('Draft, hidden from students')).toBeInTheDocument()
    expect(screen.getByText('MIME: application/zip')).toBeInTheDocument()
    expect(screen.queryByText(/AWS|ClamAV|Glacier|student downloads/i)).not.toBeInTheDocument()
  })

  test('filters by search, course, category, status and format, and sorts', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Zero Trust Security')

    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'draft' } })
    expect(rowTitles()).toEqual(['Docker Lab'])
    fireEvent.change(screen.getByLabelText('Filter by status'), { target: { value: 'all' } })

    fireEvent.change(screen.getByLabelText('Filter by course'), { target: { value: 'c2' } })
    expect(rowTitles()).toEqual(['Cloud Slides'])
    fireEvent.change(screen.getByLabelText('Filter by course'), { target: { value: 'all' } })

    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'lab' } })
    expect(rowTitles()).toEqual(['Docker Lab'])
    fireEvent.change(screen.getByLabelText('Filter by category'), { target: { value: 'all' } })

    fireEvent.change(screen.getByLabelText('Filter by format'), { target: { value: 'pptx' } })
    expect(rowTitles()).toEqual(['Cloud Slides'])
    fireEvent.change(screen.getByLabelText('Filter by format'), { target: { value: 'all' } })

    fireEvent.change(screen.getByLabelText('Search materials'), { target: { value: 'compose' } })
    expect(rowTitles()).toEqual(['Docker Lab'])
    fireEvent.change(screen.getByLabelText('Search materials'), { target: { value: 'zzz' } })
    expect(screen.getByText('No materials match these filters.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Search materials'), { target: { value: '' } })

    fireEvent.change(screen.getByLabelText('Sort materials'), { target: { value: 'title' } })
    expect(rowTitles()).toEqual(['Cloud Slides', 'Docker Lab', 'Zero Trust Security'])
    fireEvent.change(screen.getByLabelText('Sort materials'), { target: { value: 'size' } })
    expect(rowTitles()).toEqual(['Docker Lab', 'Zero Trust Security', 'Cloud Slides'])
    fireEvent.change(screen.getByLabelText('Sort materials'), { target: { value: 'oldest' } })
    expect(rowTitles()[0]).toBe('Docker Lab')
  })

  test('pages through long lists', async () => {
    store.c2 = Array.from({ length: 10 }, (_, index) => material(`m${20 + index}`, 'c2', { title: `Bulk ${index}` }))
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Page 1 of 2')
    expect(rowTitles()).toHaveLength(8)
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Page 2 of 2')).toBeInTheDocument()
    expect(rowTitles()).toHaveLength(4)
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }))
    expect(screen.getByText('Page 1 of 2')).toBeInTheDocument()
  })

  test('preselects the course from the route', async () => {
    install()
    renderAt('/lecturer/courses/c2/materials')
    expect(await screen.findByText('Cloud Slides')).toBeInTheDocument()
    expect(screen.getByLabelText('Filter by course')).toHaveValue('c2')
    expect(screen.getByLabelText('Target course *')).toHaveValue('c2')
    expect(screen.queryByText('Zero Trust Security')).not.toBeInTheDocument()
  })

  test('shows empty, error and partial-failure states', async () => {
    store = { c1: [], c2: [] }
    install()
    const first = renderAt('/lecturer/materials')
    expect(await screen.findByText(/No materials have been uploaded yet/)).toBeInTheDocument()
    first.unmount()

    install({ '/courses?page_size=100': { items: [], total: 0 } })
    const second = renderAt('/lecturer/materials')
    expect(await screen.findByText(/not assigned to any courses/)).toBeInTheDocument()
    second.unmount()

    install({ '/courses?page_size=100': new Error('down') })
    const third = renderAt('/lecturer/materials')
    const retry = await screen.findByRole('button', { name: /try again/i })
    seed()
    install()
    fireEvent.click(retry)
    expect(await screen.findByText('Zero Trust Security')).toBeInTheDocument()
    third.unmount()

    install({ '/courses/c2/materials?page_size=100': new Error('boom') })
    renderAt('/lecturer/materials')
    expect(await screen.findByText(/could not be loaded for CS402/)).toBeInTheDocument()
    expect(screen.getByText('Zero Trust Security')).toBeInTheDocument()
    expect(screen.queryByText('3 files')).not.toBeInTheDocument()
  })

  test('the storage policy opens and closes', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Zero Trust Security')
    const button = screen.getByRole('button', { name: /Storage policy/ })
    fireEvent.click(button)
    expect(screen.getByText('Each file can be up to 25 MB.')).toBeInTheDocument()
    fireEvent.click(button)
    expect(screen.queryByText('Each file can be up to 25 MB.')).not.toBeInTheDocument()
  })
})

describe('row actions', () => {
  test('publishes and unpublishes', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    fireEvent.click(screen.getByRole('button', { name: 'Publish Docker Lab' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/materials/m2', { method: 'PATCH', body: { published: true } }))
    expect(await screen.findByRole('button', { name: 'Unpublish Docker Lab' })).toBeInTheDocument()
    expect(await screen.findByText('3 published')).toBeInTheDocument()
  })

  test('shows an error when publishing fails', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'PATCH') throw new Error('Forbidden')
      return original(path, options)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Publish Docker Lab' }))
    expect(await screen.findByText('Forbidden')).toBeInTheDocument()
  })

  test('edits details with validation', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Docker Lab' }))
    const form = screen.getByRole('form', { name: 'Edit Docker Lab' })
    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'x' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    expect(screen.getByText('The title must be between 2 and 200 characters.')).toBeInTheDocument()
    expect(apiMock).not.toHaveBeenCalledWith('/materials/m2', expect.anything())

    fireEvent.change(within(form).getByLabelText('Title'), { target: { value: 'Docker Lab v2' } })
    fireEvent.change(within(form).getByLabelText('Category'), { target: { value: 'reading' } })
    fireEvent.click(within(form).getByRole('button', { name: 'Save changes' }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/materials/m2', { method: 'PATCH', body: { title: 'Docker Lab v2', description: 'Compose scaffolding', category: 'reading' } }),
    )
    expect(await screen.findByText('Docker Lab v2')).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /Edit/ })).not.toBeInTheDocument()
  })

  test('cancelling the editor changes nothing', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    fireEvent.click(screen.getByRole('button', { name: 'Edit Docker Lab' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('form', { name: /Edit/ })).not.toBeInTheDocument()
    expect(apiMock).not.toHaveBeenCalledWith('/materials/m2', expect.anything())
  })

  test('deletes only after confirmation', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    fireEvent.click(screen.getByRole('button', { name: 'Delete Docker Lab' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(apiMock).not.toHaveBeenCalledWith('/materials/m2', { method: 'DELETE' })

    fireEvent.click(screen.getByRole('button', { name: 'Delete Docker Lab' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/materials/m2', { method: 'DELETE' }))
    await waitFor(() => expect(screen.queryByText('Docker Lab')).not.toBeInTheDocument())
    expect(screen.getByText('2 files')).toBeInTheDocument()
  })

  test('downloads through a signed link and reports a failure', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => (path === '/materials/m1/download' ? { url: 'https://files.test/zt.pdf', file_name: 'zt.pdf' } : original(path, options)))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    fireEvent.click(screen.getByRole('button', { name: 'Download Zero Trust Security' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    click.mockRestore()

    apiMock.mockImplementation(async (path, options) => {
      if (path === '/materials/m2/download') throw new Error('File not found')
      return original(path, options)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Download Docker Lab' }))
    expect(await screen.findByText('File not found')).toBeInTheDocument()
  })
})

describe('upload', () => {
  const pick = (file) => fireEvent.change(screen.getByLabelText('File'), { target: { files: [file] } })

  test('validates before sending anything', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    fireEvent.click(screen.getByRole('button', { name: /^Upload material$/ }))
    expect(screen.getByText('Choose a course.')).toBeInTheDocument()
    expect(screen.getByText('The title must be between 2 and 200 characters.')).toBeInTheDocument()
    expect(screen.getByText('Choose a file to upload.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Target course *'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByLabelText('Material title *'), { target: { value: 'Notes' } })
    pick(new File(['x'], 'virus.exe', { type: 'application/octet-stream' }))
    fireEvent.click(screen.getByRole('button', { name: /^Upload material$/ }))
    expect(screen.getByText(/This file type is not allowed/)).toBeInTheDocument()

    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 26 * 1024 * 1024 })
    pick(big)
    fireEvent.click(screen.getByRole('button', { name: /^Upload material$/ }))
    expect(screen.getByText('The file is larger than 25 MB.')).toBeInTheDocument()
    expect(apiMock.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false)
  })

  test('uploads a file as multipart and refreshes the list', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    fireEvent.change(screen.getByLabelText('Target course *'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByLabelText('Material title *'), { target: { value: 'Week 09 Tracing' } })
    fireEvent.change(screen.getByLabelText('Category *'), { target: { value: 'lecture_notes' } })
    fireEvent.change(screen.getByLabelText('Description (optional)'), { target: { value: 'Spans and traces' } })
    fireEvent.click(screen.getByLabelText('Publish now so enrolled students can see it'))
    pick(new File(['%PDF'], 'wk09.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: /^Upload material$/ }))

    expect(await screen.findByText('Uploaded as a draft. Students cannot see it yet.')).toBeInTheDocument()
    const call = apiMock.mock.calls.find(([path, options]) => path === '/courses/c1/materials' && options?.method === 'POST')
    const form = call[1].form
    expect(form.get('title')).toBe('Week 09 Tracing')
    expect(form.get('category')).toBe('lecture_notes')
    expect(form.get('description')).toBe('Spans and traces')
    expect(form.get('published')).toBe('false')
    expect(form.get('file').name).toBe('wk09.pdf')
    expect(await screen.findByText('Week 09 Tracing')).toBeInTheDocument()
    expect(screen.getByLabelText('Material title *')).toHaveValue('')
  })

  test('shows the server message when the upload is rejected', async () => {
    install()
    renderAt('/lecturer/materials')
    await screen.findByText('Docker Lab')
    const original = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (path, options) => {
      if (options?.method === 'POST') throw new Error('File is larger than 25 MB')
      return original(path, options)
    })
    fireEvent.change(screen.getByLabelText('Target course *'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByLabelText('Material title *'), { target: { value: 'Notes' } })
    pick(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    fireEvent.click(screen.getByRole('button', { name: /^Upload material$/ }))
    expect(await screen.findByText('File is larger than 25 MB')).toBeInTheDocument()
  })
})
