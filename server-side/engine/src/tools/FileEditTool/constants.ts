// In its own file to avoid circular dependencies
export const FILE_EDIT_TOOL_NAME = 'Edit'

// Permission pattern for granting session-level access to the project's .Claude/ folder
export const CLAUDE_ = '/.Claude/**'

// Permission pattern for granting session-level access to the global ~/.Claude/ folder
export const GLOBAL_CLAUDE_ = '~/.Claude/**'

export const FILE_UNEXPECTEDLY_MODIFIED_ERROR =
  'File has been unexpectedly modified. Read it again before attempting to write it.'
