export default function ConfirmDialog({ open, title, message, onConfirm, onCancel }) {
  if (!open) return null
  return (
    <dialog open aria-labelledby="confirm-title">
      <h2 id="confirm-title">{title}</h2>
      <p>{message}</p>
      <button onClick={onCancel}>Cancel</button>
      <button onClick={onConfirm}>Confirm</button>
    </dialog>
  )
}
