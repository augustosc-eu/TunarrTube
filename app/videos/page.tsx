import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { db } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

function duration(seconds: number | null) {
  if (seconds == null) return "—";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function pageHref(q: string | undefined, page: number) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/videos?${query}` : "/videos";
}

export default async function VideosPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const { q, page: pageParam } = await searchParams;
  const query = q?.trim() || undefined;
  const page = Math.max(1, Number(pageParam) || 1);
  const where = query ? { OR: [{ title: { contains: query } }, { uploader: { contains: query } }] } : undefined;

  const [total, videos] = await Promise.all([
    db.video.count({ where }),
    db.video.findMany({ where, orderBy: { createdAt: "desc" }, include: { sources: { include: { source: { select: { name: true } } } } }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE })
  ]);
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return <>
    <PageHeader eyebrow="Canonical library" title="Videos" />
    <form className="toolbar" action="/videos">
      <input className="input" type="search" name="q" placeholder="Search by title or uploader…" defaultValue={query ?? ""} />
      <button className="button secondary">Search</button>
      <span className="spacer" />
      <span className="muted">{total} video{total === 1 ? "" : "s"}</span>
    </form>
    {videos.length ? <>
      <div className="table-wrap"><table><thead><tr><th>Video</th><th>Duration</th><th>Sources</th><th>Availability</th></tr></thead><tbody>{videos.map((video) => <tr key={video.id}>
        <td className="title-cell"><strong>{video.title}</strong><span className="meta">{video.uploader ?? video.youtubeId}</span></td>
        <td>{duration(video.durationSeconds)}</td>
        <td>{video.sources.map((membership) => membership.source.name).join(", ")}</td>
        <td><span className={`badge ${video.availability}`}>{video.availability}</span>{video.availabilityReason ? <span className="availability-reason">{video.availabilityReason}</span> : null}</td>
      </tr>)}</tbody></table></div>
      {pageCount > 1 ? <div className="toolbar" style={{ marginTop: 16 }}>
        {page > 1 ? <Link className="button secondary" href={pageHref(query, page - 1)}>Previous</Link> : <button className="button secondary" disabled>Previous</button>}
        <span className="muted">Page {page} of {pageCount}</span>
        {page < pageCount ? <Link className="button secondary" href={pageHref(query, page + 1)}>Next</Link> : <button className="button secondary" disabled>Next</button>}
      </div> : null}
    </> : <div className="empty"><h2>{query ? "No matching videos" : "No videos yet"}</h2><p>{query ? "Try a different search term." : "Videos appear here after a source is added."}</p></div>}
  </>;
}
