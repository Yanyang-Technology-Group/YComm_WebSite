/**
 * `@ycomm/downloads` — resources, links, gated fetching.
 *
 * The security invariant lives in `fetch.ts`: the only piece of code allowed to
 * read link URLs at serving time, after the full decision chain. Everything
 * else deals in metadata without URLs.
 */
export {
  createCategory,
  getCategoryBySlug,
  listVisibleCategories,
  updateCategory,
  type CategoryRow,
  type CategoryView,
} from './categories';
export {
  createCard,
  deleteCard,
  getCard,
  insertCardBefore,
  listAllCards,
  listCards,
  listVisibleCards,
  moveCard,
  reviewCard,
  searchCards,
  updateCard,
  type CardKind,
  type CardReviewDecision,
  type CardRow,
  type CardVisibility,
  type CreateCardInput,
  type UpdateCardInput,
} from './cards';
export { registerDownloadDeciders } from './deciders';
export {
  authorizedExtractCode,
  authorizedFetch,
  type DownloadOutcome,
  type DownloadResource,
} from './fetch';
export { addLink, getActiveLinks, getLinkRow, getResourceIdByLink, removeLink, type AddLinkInput, type LinkRow } from './links';
export { openLocalFile, saveLocalFile, sniffMime, type OpenedLocalFile, type SavedFile } from './local-files';
export { listResourcesByAuthor } from './my-resources';
export { reportDeadLink, reportDeadLinkByResource } from './reports';
export {
  archiveResource,
  createResource,
  getResource,
  getResourceRow,
  listAllResources,
  listPublishedResources,
  requestReReview,
  softDeleteResource,
  updateResourceMetadata,
  withdrawResource,
  type CreateResourceInput,
  type ResourceListOptions,
  type ResourceRow,
  type ResourceStatus,
  type ResourceView,
  type UpdateResourceInput,
} from './resources';