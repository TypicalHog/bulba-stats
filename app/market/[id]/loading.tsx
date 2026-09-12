import { PanelSkeleton, TileRowSkeleton } from "@/components/ui/skeleton";

/**
 * Wraps this route's page (and its `notFound()` calls) in a Suspense
 * boundary — see BSM-124. Without this file the page's own `notFound()`
 * fires below the layout's already-streaming search-index boundary with
 * nothing local to catch it, so Next aborts the stream and ships an empty
 * document (no nav, footer, or copy) instead of swapping in `not-found.tsx`
 * within the shell.
 */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4">
      <PanelSkeleton height={64} />
      <TileRowSkeleton count={7} cols="md:grid-cols-4 xl:grid-cols-7" />
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <PanelSkeleton height={360} />
          <PanelSkeleton height={300} />
          <PanelSkeleton height={300} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <PanelSkeleton height={420} />
          <PanelSkeleton height={260} />
        </div>
      </div>
    </div>
  );
}
