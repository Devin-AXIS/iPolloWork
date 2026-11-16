# App data attachments

Upgrade the account service before clients that use `app.files`. Startup applies business migration 11; back up the account database first. The migration creates attachment metadata only. Application record tables remain in their independent database.

New record writes reject inline data URLs, blob URLs and common binary encodings with `DATA_BINARY_INLINE`. Upload bytes with the app attachment API and store its returned ID. Existing records are retained and readable; they are not silently converted or removed. File uploads require sign-in, share the owner's storage quota and use private OSS in production. Local development may use the private file cache. See [API and permissions](../../../../services/ipollowork/docs/app-data.md#files-and-images).
