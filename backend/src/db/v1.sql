SET NAMES utf8mb4;

DROP DATABASE IF EXISTS ict_association;
CREATE DATABASE ict_association
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_0900_ai_ci;
USE ict_association;

-- ---------- 1. 管理员表 ----------
CREATE TABLE admins (
                        id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                        username      VARCHAR(50)  NOT NULL COMMENT '登录名',
                        password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt/argon2 哈希, 绝不存明文',
                        nickname      VARCHAR(50)  NULL COMMENT '显示昵称',
                        email         VARCHAR(255) NULL COMMENT '邮箱',
                        status        TINYINT      NOT NULL DEFAULT 1 COMMENT '1正常 0禁用',
                        last_login_at DATETIME     NULL COMMENT '最近登录时间',
                        created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                        PRIMARY KEY (id),
                        UNIQUE KEY uk_username (username),
                        UNIQUE KEY uk_email (email)
) ENGINE=InnoDB COMMENT='管理员表';

-- ---------- 2. 静态资源表 ----------
CREATE TABLE static_assets (
                               id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                               filename    VARCHAR(255) NOT NULL COMMENT '原始文件名(清洗后仅作展示, 不参与路径拼接)',
                               path        VARCHAR(500) NOT NULL COMMENT '存储相对路径, 形如 article/2f1c....png',
                               url         VARCHAR(500) NULL COMMENT '对外访问地址(CDN/OSS), 未接 CDN 时留空直接用 path',
                               mime_type   VARCHAR(100) NULL COMMENT 'MIME, 如 image/png',
                               category    VARCHAR(50)  NOT NULL DEFAULT 'general' COMMENT '用途: article(文章配图, 仅管理员上传) / gallery(图库, 仅管理员上传) / comment(评论配图, 管理员与游客均可上传); 保留历史分类值',
                               size_bytes  INT UNSIGNED NULL COMMENT '文件大小(字节)',
                               md5         CHAR(32)     NULL COMMENT '内容指纹(MD5), 同分类下字节完全一致即视为重复; 历史记录为 NULL 不参与去重',
                               uploader_id BIGINT UNSIGNED NULL COMMENT '上传者 admins.id, 游客上传为 NULL',
                               created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                               deleted_at  DATETIME     NULL DEFAULT NULL COMMENT '软删除时间; NULL=未删除, 非 NULL=已删除(仅影响管理状态, 不撤销已有访问地址)',
                               PRIMARY KEY (id),
                               UNIQUE KEY uk_path (path),
                               KEY idx_category (category),
                               KEY idx_category_md5 (category, md5),
                               KEY idx_deleted_id (deleted_at, id),
                               CONSTRAINT fk_assets_uploader FOREIGN KEY (uploader_id) REFERENCES admins (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='静态资源表';

-- ---------- 3. 文章分类表 (上次漏掉的表, 必须先于 articles 创建) ----------
CREATE TABLE categories (
                            id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                            name       VARCHAR(50) NOT NULL COMMENT '分类名, 如 协会公告',
                            slug       VARCHAR(50) NOT NULL COMMENT 'URL 标识, 如 announcement',
                            parent_id  BIGINT UNSIGNED NULL COMMENT '父分类, 支持二级分类',
                            sort_order INT         NOT NULL DEFAULT 0 COMMENT '排序, 越小越靠前',
                            created_at DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                            PRIMARY KEY (id),
                            UNIQUE KEY uk_slug (slug),
                            KEY idx_parent (parent_id)
) ENGINE=InnoDB COMMENT='文章分类表';

-- ---------- 4. 文章表 ----------
CREATE TABLE articles (
                          id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                          title          VARCHAR(200) NOT NULL COMMENT '标题',
                          slug           VARCHAR(200) NOT NULL COMMENT 'URL 标识, 对应前端 news 的 slug',
                          summary        VARCHAR(500) NULL COMMENT '摘要, 列表页展示',
                          content        LONGTEXT     NOT NULL COMMENT '正文, 建议存 Markdown',
                          cover_asset_id BIGINT UNSIGNED NULL COMMENT '封面图, 指向 static_assets.id',
                          category_id    BIGINT UNSIGNED NULL COMMENT '分类 categories.id',
                          status         TINYINT      NOT NULL DEFAULT 0 COMMENT '0草稿 1已发布 2已下架',
                          is_top         TINYINT(1)   NOT NULL DEFAULT 0 COMMENT '是否置顶',
                          view_count     INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '浏览量',
                          published_at   DATETIME     NULL COMMENT '发布时间, 决定列表排序',
                          created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                          PRIMARY KEY (id),
                          UNIQUE KEY uk_slug (slug),
                          KEY idx_status_published (status, published_at),
                          KEY idx_category (category_id),
                          CONSTRAINT fk_articles_cover    FOREIGN KEY (cover_asset_id) REFERENCES static_assets (id) ON DELETE SET NULL,
                          CONSTRAINT fk_articles_category FOREIGN KEY (category_id)   REFERENCES categories (id)  ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='文章表';

-- ---------- 5. 标签表 ----------
CREATE TABLE tags (
                      id   BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                      name VARCHAR(50) NOT NULL COMMENT '标签名',
                      slug VARCHAR(50) NOT NULL COMMENT 'URL 标识',
                      PRIMARY KEY (id),
                      UNIQUE KEY uk_name (name),
                      UNIQUE KEY uk_slug (slug)
) ENGINE=InnoDB COMMENT='标签表';

-- ---------- 6. 文章-标签关联表 ----------
CREATE TABLE article_tags (
                              article_id BIGINT UNSIGNED NOT NULL COMMENT '文章 id',
                              tag_id     BIGINT UNSIGNED NOT NULL COMMENT '标签 id',
                              PRIMARY KEY (article_id, tag_id),
                              KEY idx_tag (tag_id),
                              CONSTRAINT fk_at_article FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE,
                              CONSTRAINT fk_at_tag     FOREIGN KEY (tag_id)     REFERENCES tags (id)     ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='文章-标签关联表';

-- ---------- 7. 评论表 ----------
CREATE TABLE comments (
                          id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                          article_id BIGINT UNSIGNED NOT NULL COMMENT '所属文章',
                          parent_id  BIGINT UNSIGNED NULL COMMENT '父评论 id; NULL=一级评论, 非NULL=回复',
                          root_id    BIGINT UNSIGNED NULL COMMENT '所在楼层的一级评论 id, 用于一次查出一整层楼',
                          content    TEXT         NOT NULL COMMENT '评论内容',
                          username   VARCHAR(50)  NOT NULL COMMENT '昵称(游客评论时填写)',
                          email      VARCHAR(255) NULL COMMENT '邮箱, 仅后台可见, 前台绝不展示',
                          ip         VARCHAR(45)  NOT NULL COMMENT '评论者 IP(IPv4/IPv6), 防刷与追溯',
                          status     TINYINT      NOT NULL DEFAULT 1 COMMENT '0待审核 1已通过 2已删除',
                          like_count INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '点赞数',
                          created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                          PRIMARY KEY (id),
                          KEY idx_article_status (article_id, status, created_at),
                          KEY idx_root (root_id),
                          CONSTRAINT fk_c_article FOREIGN KEY (article_id) REFERENCES articles (id) ON DELETE CASCADE,
                          CONSTRAINT fk_c_parent  FOREIGN KEY (parent_id)  REFERENCES comments (id) ON DELETE CASCADE,
                          CONSTRAINT fk_c_root    FOREIGN KEY (root_id)    REFERENCES comments (id) ON DELETE CASCADE
) ENGINE=InnoDB COMMENT='评论表';

-- ---------- 8. 系统日志表 ----------
CREATE TABLE system_logs (
                             id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                             level        ENUM('ERROR','WARN','INFO') NOT NULL DEFAULT 'INFO' COMMENT '等级: 错误/警告/日志',
                             operation    VARCHAR(100) NOT NULL COMMENT '操作名, 如 发表评论/登录/上传文件',
                             module       VARCHAR(50)  NULL COMMENT '模块: article/comment/auth/upload',
                             operator_id  BIGINT UNSIGNED NULL COMMENT '操作者 admins.id, 游客操作为 NULL',
                             ip           VARCHAR(45)  NULL COMMENT '操作者 IP',
                             request_path VARCHAR(255) NULL COMMENT '请求路径, 如 POST /api/comments',
                             status_code  SMALLINT     NULL COMMENT 'HTTP 状态码, 排查 4xx/5xx',
                             detail       TEXT         NULL COMMENT '详情: 参数摘要/错误堆栈(务必脱敏, 不存密码)',
                             created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                             PRIMARY KEY (id),
                             KEY idx_level_time (level, created_at),
                             KEY idx_operator (operator_id),
                             KEY idx_created (created_at),
                             CONSTRAINT fk_logs_operator FOREIGN KEY (operator_id) REFERENCES admins (id) ON DELETE SET NULL
) ENGINE=InnoDB COMMENT='系统日志表';

-- ---------- 9. 首页轮播图 ----------
CREATE TABLE banners (
                         id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
                         title          VARCHAR(100) NOT NULL COMMENT '标题',
                         image_asset_id BIGINT UNSIGNED NOT NULL COMMENT '图片, static_assets.id',
                         link_url       VARCHAR(500) NULL COMMENT '点击跳转链接',
                         sort_order     INT          NOT NULL DEFAULT 0 COMMENT '排序',
                         status         TINYINT      NOT NULL DEFAULT 1 COMMENT '1上架 0下架',
                         start_at       DATETIME     NULL COMMENT '上架时间',
                         end_at         DATETIME     NULL COMMENT '下架时间',
                         created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
                         PRIMARY KEY (id),
                         KEY idx_status_sort (status, sort_order),
                         CONSTRAINT fk_banners_asset FOREIGN KEY (image_asset_id) REFERENCES static_assets (id)
) ENGINE=InnoDB COMMENT='首页轮播图';

-- ---------- 初始化数据 ----------
INSERT INTO categories (name, slug, sort_order) VALUES
                                                    ('社区共创', 'community',    1),
                                                    ('协会公告', 'announcement', 2),
                                                    ('认识我们', 'about-us',     3);