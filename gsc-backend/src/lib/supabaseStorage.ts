import { StorageClient } from "@supabase/storage-js";
import crypto from "crypto";

const storageClient = new StorageClient(
  `${process.env.SUPABASE_URL}/storage/v1`,
  {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  },
);

export async function uploadToSupabase(bucket, file) {
  const ext = "." + file.originalname.split(".").pop().toLowerCase();
  const filename = `${crypto.randomUUID()}${ext}`;

  const { error } = await storageClient
    .from(bucket)
    .upload(filename, file.buffer, {
      contentType: file.mimetype,
      upsert: false,
    });

  if (error) {
    throw new Error(`Failed to upload file to Supabase: ${error.message}`);
  }

  const { data } = storageClient.from(bucket).getPublicUrl(filename);
  return { url: data.publicUrl, originalName: file.originalname };
}
