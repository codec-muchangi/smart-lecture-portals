// Every page listed in docs/FRONTEND.md renders through a feature module in its phase.
// Until then it shows its name and the SRS phase that delivers it.
export default function Placeholder({ title, phase }) {
  return (
    <section>
      <h1>{title}</h1>
      <p>Delivered in {phase}. See docs/FRONTEND.md.</p>
    </section>
  )
}
