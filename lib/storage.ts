import { supabase } from "@/utils/supabase/client"

/**
 * Uploads a member photo (Blob or File) to the 'member-photos' Supabase Storage bucket.
 * Returns the public CDN URL.
 *
 * Photos are stored in Storage (not as base64 in the DB) so they are:
 * - Served via Supabase CDN (cached egress — free)
 * - Not counted against DB egress
 * - Not bloating DB query responses
 */
export async function uploadMemberPhoto(file: Blob | File): Promise<string> {
  const fileExt = (file.type && file.type.split('/')[1]) || 'jpg'
  const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${fileExt}`
  const filePath = `photos/${fileName}`

  const { data, error } = await supabase.storage
    .from('member-photos')
    .upload(filePath, file, { upsert: true, cacheControl: '3600' })

  if (error) {
    console.error("Supabase storage upload error:", error)
    throw new Error(`Photo upload failed: ${error.message}`)
  }

  const { data: publicUrlData } = supabase.storage
    .from('member-photos')
    .getPublicUrl(data.path)

  return publicUrlData.publicUrl
}

/**
 * Deletes a member photo from Storage given its public URL.
 * Safe to call with base64 or null values (no-op).
 */
export async function deleteMemberPhoto(photoUrl: string | null | undefined): Promise<void> {
  if (!photoUrl || photoUrl.startsWith('data:')) return

  try {
    // Extract the path from the public URL
    // URL format: https://[project].supabase.co/storage/v1/object/public/member-photos/photos/filename.jpg
    const url = new URL(photoUrl)
    const pathMatch = url.pathname.match(/\/storage\/v1\/object\/public\/member-photos\/(.+)/)
    if (!pathMatch) return

    const filePath = pathMatch[1]
    await supabase.storage.from('member-photos').remove([filePath])
  } catch (err) {
    // Non-critical — log but don't throw
    console.warn("Failed to delete old photo from storage:", err)
  }
}
