import { redirect } from "next/navigation";

// Doc Template was merged into Documents (C-6); this keeps old bookmarks and
// links working instead of 404ing.
export default function AdminDocTemplatesRedirect() {
  redirect("/admin/documents");
}
