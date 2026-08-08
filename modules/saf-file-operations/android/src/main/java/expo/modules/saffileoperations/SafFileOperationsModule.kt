package expo.modules.saffileoperations

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.DocumentsContract
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SafFileOperationsModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("SafFileOperations")

    AsyncFunction("createEntry") {
        rootUri: String,
        parentUri: String,
        name: String,
        mimeType: String?,
        isDirectory: Boolean ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SafFileOperations(context).createEntry(
        Uri.parse(rootUri),
        Uri.parse(parentUri),
        name,
        mimeType,
        isDirectory,
      ).toString()
    }

    AsyncFunction("relocateEntry") {
        rootUri: String,
        sourceUri: String,
        sourceParentUri: String,
        destinationParentUri: String,
        destinationName: String ->
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      SafFileOperations(context).relocateEntry(
        Uri.parse(rootUri),
        Uri.parse(sourceUri),
        Uri.parse(sourceParentUri),
        Uri.parse(destinationParentUri),
        destinationName,
      ).toString()
    }
  }
}

private class SafFileOperations(private val context: Context) {
  private val resolver: ContentResolver = context.contentResolver

  fun createEntry(
    rootUri: Uri,
    parentUri: Uri,
    name: String,
    mimeType: String?,
    isDirectory: Boolean,
  ): Uri {
    validateName(name)
    requireWithinRoot(rootUri, parentUri, "Destination folder")
    requireDirectory(parentUri, "Destination folder")
    return createExact(parentUri, name, mimeType, isDirectory)
  }

  fun relocateEntry(
    rootUri: Uri,
    sourceUri: Uri,
    sourceParentUri: Uri,
    destinationParentUri: Uri,
    destinationName: String,
  ): Uri {
    validateName(destinationName)
    requireWithinRoot(rootUri, sourceUri, "Source")
    requireWithinRoot(rootUri, sourceParentUri, "Source folder")
    requireWithinRoot(rootUri, destinationParentUri, "Destination folder")
    requireDirectory(sourceParentUri, "Source folder")
    requireDirectory(destinationParentUri, "Destination folder")

    val source = queryDocument(sourceUri)
      ?: throw IllegalStateException("The source entry no longer exists.")
    requireDirectChild(sourceParentUri, source.uri, "Source entry")
    if (
      source.isDirectory &&
      isSameOrChildDocument(source.uri, destinationParentUri)
    ) {
      throw IllegalStateException("A folder cannot be moved into its own contents.")
    }

    val sameParent = sameDocument(sourceParentUri, destinationParentUri)
    val collision = listChildren(destinationParentUri).firstOrNull {
      it.name == destinationName && !sameDocument(it.uri, source.uri)
    }
    if (collision != null) {
      throw IllegalStateException(
        "A file or folder named \"$destinationName\" already exists in the destination folder.",
      )
    }

    if (sameParent && source.name == destinationName) {
      return source.uri
    }

    if (sameParent) {
      tryRename(source, destinationName)?.let { return it }
    } else if (source.name == destinationName) {
      tryMove(source, sourceParentUri, destinationParentUri)?.let { return it }
    }

    return copyThenDelete(source, destinationParentUri, destinationName)
  }

  private fun tryRename(source: DocumentInfo, destinationName: String): Uri? {
    val renamed = try {
      DocumentsContract.renameDocument(resolver, source.uri, destinationName)
    } catch (_: Exception) {
      null
    } ?: return null

    val renamedInfo = queryDocument(renamed)
    if (renamedInfo?.name == destinationName) {
      return renamed
    }

    try {
      DocumentsContract.renameDocument(resolver, renamed, source.name)
    } catch (_: Exception) {}
    throw IllegalStateException(
      "The storage provider did not use the requested name \"$destinationName\".",
    )
  }

  private fun tryMove(
    source: DocumentInfo,
    sourceParentUri: Uri,
    destinationParentUri: Uri,
  ): Uri? {
    val moved = try {
      DocumentsContract.moveDocument(
        resolver,
        source.uri,
        asDocumentUri(sourceParentUri),
        asDocumentUri(destinationParentUri),
      )
    } catch (_: Exception) {
      null
    } ?: return null

    val movedInfo = queryDocument(moved)
    if (movedInfo?.name == source.name) {
      return moved
    }

    try {
      DocumentsContract.moveDocument(
        resolver,
        moved,
        asDocumentUri(destinationParentUri),
        asDocumentUri(sourceParentUri),
      )
    } catch (_: Exception) {}
    throw IllegalStateException("The storage provider changed the entry name while moving it.")
  }

  private fun copyThenDelete(
    source: DocumentInfo,
    destinationParentUri: Uri,
    destinationName: String,
  ): Uri {
    val destination = copyEntry(source, destinationParentUri, destinationName)

    try {
      if (DocumentsContract.deleteDocument(resolver, source.uri)) {
        return destination
      }
    } catch (error: Exception) {
      if (!documentExists(source.uri)) {
        return destination
      }
      deleteQuietly(destination)
      throw IllegalStateException(
        "The destination was copied, but the source could not be deleted. The copy was removed and the source was kept.",
        error,
      )
    }

    if (!documentExists(source.uri)) {
      return destination
    }

    deleteQuietly(destination)
    throw IllegalStateException(
      "The destination was copied, but the source could not be deleted. The copy was removed and the source was kept.",
    )
  }

  private fun copyEntry(
    source: DocumentInfo,
    destinationParentUri: Uri,
    destinationName: String,
  ): Uri {
    val destination = createExact(
      destinationParentUri,
      destinationName,
      source.mimeType,
      source.isDirectory,
    )

    try {
      if (source.isDirectory) {
        listChildren(source.uri).forEach { child ->
          copyEntry(child, destination, child.name)
        }
      } else {
        resolver.openInputStream(source.uri)?.use { sourceStream ->
          resolver.openOutputStream(destination, "wt")?.use { destinationStream ->
            sourceStream.copyTo(destinationStream)
          } ?: throw IllegalStateException(
            "The destination file could not be opened for writing.",
          )
        } ?: throw IllegalStateException(
          "The source file could not be opened for reading.",
        )
      }
      return destination
    } catch (error: Exception) {
      deleteQuietly(destination)
      throw error
    }
  }

  private fun isSameOrChildDocument(parentUri: Uri, candidateUri: Uri): Boolean {
    if (sameDocument(parentUri, candidateUri)) {
      return true
    }

    return try {
      DocumentsContract.isChildDocument(
        resolver,
        asDocumentUri(parentUri),
        asDocumentUri(candidateUri),
      )
    } catch (_: Exception) {
      false
    }
  }

  private fun createExact(
    parentUri: Uri,
    name: String,
    mimeType: String?,
    isDirectory: Boolean,
  ): Uri {
    if (listChildren(parentUri).any { it.name == name }) {
      throw IllegalStateException(
        "A file or folder named \"$name\" already exists in the destination folder.",
      )
    }

    val created = DocumentsContract.createDocument(
      resolver,
      asDocumentUri(parentUri),
      if (isDirectory) DocumentsContract.Document.MIME_TYPE_DIR
      else mimeType ?: "application/octet-stream",
      name,
    ) ?: throw IllegalStateException("The storage provider could not create \"$name\".")

    val createdInfo = queryDocument(created)
    if (createdInfo?.name == name) {
      return created
    }

    deleteQuietly(created)
    throw IllegalStateException(
      "The storage provider did not use the requested name \"$name\".",
    )
  }

  private fun requireDirectory(uri: Uri, label: String) {
    val document = queryDocument(uri)
      ?: throw IllegalStateException("$label no longer exists.")
    if (!document.isDirectory) {
      throw IllegalStateException("$label is not a folder.")
    }
  }

  private fun requireDirectChild(parentUri: Uri, childUri: Uri, label: String) {
    if (listChildren(parentUri).none { sameDocument(it.uri, childUri) }) {
      throw IllegalStateException("$label is no longer inside its expected parent folder.")
    }
  }

  private fun requireWithinRoot(rootUri: Uri, candidateUri: Uri, label: String) {
    requireContentUri(rootUri)
    requireContentUri(candidateUri)
    if (rootUri.authority != candidateUri.authority) {
      throw IllegalStateException("$label is outside the granted folder.")
    }

    val rootDocumentId = documentId(rootUri)
    val candidateDocumentId = documentId(candidateUri)
    if (rootDocumentId == candidateDocumentId) {
      return
    }

    if (DocumentsContract.isTreeUri(candidateUri)) {
      val candidateTreeId = DocumentsContract.getTreeDocumentId(candidateUri)
      if (candidateTreeId == rootDocumentId) {
        return
      }
    }

    val isChild = try {
      DocumentsContract.isChildDocument(
        resolver,
        asDocumentUri(rootUri),
        asDocumentUri(candidateUri),
      )
    } catch (_: Exception) {
      false
    }
    if (!isChild) {
      throw IllegalStateException("$label is outside the granted folder.")
    }
  }

  private fun listChildren(parentUri: Uri): List<DocumentInfo> {
    val parentDocumentId = documentId(parentUri)
    val childrenUri = if (DocumentsContract.isTreeUri(parentUri)) {
      DocumentsContract.buildChildDocumentsUriUsingTree(parentUri, parentDocumentId)
    } else {
      DocumentsContract.buildChildDocumentsUri(parentUri.authority, parentDocumentId)
    }
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )

    return resolver.query(childrenUri, projection, null, null, null)?.use { cursor ->
      val idIndex = cursor.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      )
      val nameIndex = cursor.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      )
      val mimeTypeIndex = cursor.getColumnIndexOrThrow(
        DocumentsContract.Document.COLUMN_MIME_TYPE,
      )
      buildList {
        while (cursor.moveToNext()) {
          val childDocumentId = cursor.getString(idIndex)
          val childUri = if (DocumentsContract.isTreeUri(parentUri)) {
            DocumentsContract.buildDocumentUriUsingTree(parentUri, childDocumentId)
          } else {
            DocumentsContract.buildDocumentUri(parentUri.authority, childDocumentId)
          }
          add(
            DocumentInfo(
              uri = childUri,
              name = cursor.getString(nameIndex),
              mimeType = cursor.getString(mimeTypeIndex),
            ),
          )
        }
      }
    } ?: throw IllegalStateException("The folder contents could not be read.")
  }

  private fun queryDocument(uri: Uri): DocumentInfo? {
    val documentUri = asDocumentUri(uri)
    val projection = arrayOf(
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
    )
    return resolver.query(documentUri, projection, null, null, null)?.use { cursor ->
      if (!cursor.moveToFirst()) {
        return@use null
      }
      DocumentInfo(
        uri = documentUri,
        name = cursor.getString(
          cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_DISPLAY_NAME),
        ),
        mimeType = cursor.getString(
          cursor.getColumnIndexOrThrow(DocumentsContract.Document.COLUMN_MIME_TYPE),
        ),
      )
    }
  }

  private fun documentExists(uri: Uri): Boolean = try {
    queryDocument(uri) != null
  } catch (_: Exception) {
    false
  }

  private fun deleteQuietly(uri: Uri) {
    try {
      DocumentsContract.deleteDocument(resolver, uri)
    } catch (_: Exception) {}
  }

  private fun sameDocument(left: Uri, right: Uri): Boolean =
    left.authority == right.authority && documentId(left) == documentId(right)

  private fun asDocumentUri(uri: Uri): Uri {
    requireContentUri(uri)
    return when {
      DocumentsContract.isDocumentUri(context, uri) -> uri
      DocumentsContract.isTreeUri(uri) -> DocumentsContract.buildDocumentUriUsingTree(
        uri,
        DocumentsContract.getTreeDocumentId(uri),
      )
      else -> throw IllegalStateException("URI is not an Android document URI: $uri")
    }
  }

  private fun documentId(uri: Uri): String {
    val documentUri = asDocumentUri(uri)
    return DocumentsContract.getDocumentId(documentUri)
  }

  private fun requireContentUri(uri: Uri) {
    if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
      throw IllegalStateException("Android SAF operations require content:// URIs.")
    }
  }

  private fun validateName(name: String) {
    if (
      name.isBlank() ||
      name == "." ||
      name == ".." ||
      name.contains('/') ||
      name.contains('\\') ||
      name.contains('\u0000')
    ) {
      throw IllegalArgumentException("Provide a valid file or folder name.")
    }
  }
}

private data class DocumentInfo(
  val uri: Uri,
  val name: String,
  val mimeType: String,
) {
  val isDirectory: Boolean
    get() = mimeType == DocumentsContract.Document.MIME_TYPE_DIR
}
