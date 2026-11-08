import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../app/AuthContext.jsx'
import { api } from '../services/apiClient.js'
import { PHOTO_ACCEPT, checkPhotoFile } from '../utils/settingsHelpers.js'

// Upload / replace / remove the profile photo. Shared by the student and lecturer
// Settings pages. The photo is saved the moment it is chosen (POST /me/avatar); it is
// not part of the "Save changes" form. Remove calls DELETE /me/avatar.

const ME_KEY = ['me']

export default function ProfilePhotoControls() {
  const queryClient = useQueryClient()
  const { refresh } = useAuth()
  const input = useRef(null)
  const [note, setNote] = useState(null)

  const meQuery = useQuery({ queryKey: ME_KEY, queryFn: () => api('/me') })
  const hasPhoto = Boolean(meQuery.data?.avatar_url)

  const finished = async (text) => {
    setNote({ ok: true, text })
    await queryClient.invalidateQueries({ queryKey: ME_KEY })
    if (typeof refresh === 'function') await refresh()
  }
  const failed = (fallback) => (error) => setNote({ ok: false, text: error?.message || fallback })

  const upload = useMutation({
    mutationFn: (file) => {
      const form = new FormData()
      form.append('file', file)
      return api('/me/avatar', { method: 'POST', form })
    },
    onSuccess: () => finished('Photo updated.'),
    onError: failed('The photo could not be uploaded. Please try again.'),
  })
  const remove = useMutation({
    mutationFn: () => api('/me/avatar', { method: 'DELETE' }),
    onSuccess: () => finished('Photo removed.'),
    onError: failed('The photo could not be removed. Please try again.'),
  })
  const busy = upload.isPending || remove.isPending

  const choose = (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const problem = checkPhotoFile(file)
    if (problem) {
      setNote({ ok: false, text: problem })
      return
    }
    setNote(null)
    upload.mutate(file)
  }

  return (
    <div style={{ display: 'grid', gap: '0.5rem' }}>
      <input
        ref={input}
        type="file"
        accept={PHOTO_ACCEPT}
        onChange={choose}
        aria-label="Profile photo file"
        hidden
      />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        <button
          type="button"
          className="slpc-btn slpc-btn-soft"
          onClick={() => input.current?.click()}
          disabled={busy}
        >
          {upload.isPending ? 'Uploading...' : hasPhoto ? 'Change photo' : 'Upload photo'}
        </button>
        <button
          type="button"
          className="slpc-btn slpc-btn-soft"
          onClick={() => remove.mutate()}
          disabled={!hasPhoto || busy}
        >
          {remove.isPending ? 'Removing...' : 'Remove photo'}
        </button>
      </div>
      <span style={{ fontSize: '0.8125rem', opacity: 0.75 }}>
        JPEG, PNG or WebP, up to 2 MB. It is saved as soon as you choose it.
      </span>
      {note && (
        <p
          role={note.ok ? 'status' : 'alert'}
          style={{ margin: 0, fontSize: '0.875rem', color: note.ok ? 'inherit' : '#b3261e' }}
        >
          {note.text}
        </p>
      )}
    </div>
  )
}