export function TitleBar() {
  return (
    <header
      className="h-11 flex-shrink-0 relative flex items-center bg-elevated"
      style={{ WebkitAppRegion: 'drag' }}
    >
      <span className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-foreground pointer-events-none">
        YT Download
      </span>
    </header>
  )
}
