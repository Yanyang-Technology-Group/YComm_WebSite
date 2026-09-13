/**
 * `@ycomm/forum` — boards, topics, posts, reactions.
 *
 * Services here are permission-agnostic data operations; the HTTP layer applies
 * the access decision chain (state gate → board policy → permission points)
 * before calling in. Ownership checks that depend on the caller (edit windows,
 * staff deletes) are enforced here where they belong to the domain.
 */
export {
  archiveBoard,
  createBoard,
  getBoardById,
  getBoardBySlug,
  listAllBoards,
  listBoards,
  restoreBoard,
  updateBoard,
  type BoardRow,
  type BoardView,
  type CreateBoardInput,
} from './boards';
export { bumpUserStats, getPostCount } from './counters';
export { registerForumDeciders } from './deciders';
export { listPostsByAuthor, listTopicsByAuthor } from './my-content';
export {
  createPost,
  deletePost,
  editPost,
  getPostById,
  hasLiked,
  likePost,
  listPostRevisions,
  listPosts,
  listTopicPreviews,
  unlikePost,
  type CreatePostInput,
  type PostRow,
  type PostWithAuthor,
  type TopicPostPreview,
  type TopicPreview,
} from './posts';
export { newTopicSlug } from './slug';
export {
  createTopic,
  getTopicById,
  incrementViewCount,
  listTopics,
  moderateTopic,
  searchTopics,
  type CreateTopicInput,
  type CreateTopicResult,
  type TopicListOptions,
  type TopicModerationAction,
  type TopicRow,
  type TopicWithAuthor,
} from './topics';