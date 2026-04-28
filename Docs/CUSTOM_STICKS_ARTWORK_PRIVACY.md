# Custom Sticks Artwork Privacy

## Current Handling
- New custom sticks artwork uploads go to the private Supabase Storage bucket `custom-sticks-artwork`.
- New browser uploads first request a server-generated signed upload token from `custom-sticks-artwork-upload`; the browser does not get direct anonymous Storage insert permission.
- New uploads use the `private/` object prefix and keep the existing 5 MB PNG/JPG/WEBP limits.
- Custom sticks procurement leads store artwork details in `lead_submissions.metadata.customSticksArtwork`, including bucket, storage path, file name, MIME type, size, and private access status.
- Procurement lead text includes the storage bucket/path for operations context, not a long-lived public URL.
- Lead intake verifies the uploaded object exists and checks Storage metadata against the submitted MIME type and size before saving the lead.

## Admin Access
- Super-admin users should generate short-lived links only when they need to inspect submitted artwork.
- The `custom-sticks-artwork-link` Edge Function requires an authenticated super-admin session through `x-supabase-auth-token`.
- Request body:

```json
{
  "storagePath": "private/<object-name>"
}
```

- The function returns a signed URL capped at 15 minutes. Do not paste the signed URL into public tickets, customer emails, or long-lived notes.
- The service-role key remains server-side in the Edge Function environment only.
- For localhost QA, sign in as a super-admin, copy the browser session access token from Supabase Auth debug tooling, and send it as `x-supabase-auth-token` with the local function URL.

## Existing Public Objects
- The privacy migration changes `custom-sticks-artwork` to `public = false` and removes anonymous read policy, so old public URLs should stop being a durable access path.
- Owner review should inventory legacy `public/` objects before deletion:

```sql
select
  name,
  created_at,
  updated_at,
  metadata->>'mimetype' as mime_type,
  metadata->>'size' as size_bytes
from storage.objects
where bucket_id = 'custom-sticks-artwork'
  and (storage.foldername(name))[1] = 'public'
order by created_at desc;
```

- Compare inventory against older `lead_submissions.message` rows containing `Artwork URL:`. Keep or migrate only artwork still needed for active procurement.
- For retained legacy artwork, either leave it private under the existing `public/` object path and use the signed-link function, or copy it into `private/` and update the related lead metadata during owner-approved cleanup.
- Delete abandoned or duplicate legacy artwork only after owner review confirms it is no longer needed.
