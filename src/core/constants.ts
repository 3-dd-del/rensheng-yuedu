/** 分块存储时每块包含的字符数。块越小，随机读取某页附近的文本越省内存。 */
export const CHUNK_SIZE = 100_000;

/** IndexedDB 数据库名。浏览器与 http://127.0.0.1:48123 绑定。 */
export const DB_NAME = 'rensheng-yuedu';

/** 阅读内容区域允许的最大宽度（px），保证长行时依然易读。 */
export const MAX_READING_WIDTH = 760;

/** 连续排版定位时，每批边界计算后让出主线程一次。 */
export const PAGE_YIELD_EVERY = 20;

/** 备份文件格式版本。 */
export const BACKUP_FORMAT_VERSION = 1;
