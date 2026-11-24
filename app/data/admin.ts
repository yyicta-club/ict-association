// Admin 后台 mock 数据 —— 本次所有页面均为纯前端展示，不接入后端。
// 后续接入后端时，将本文件中的常量替换为 $fetch 请求即可（见 ADMIN_PLAN.md 第 13 节）。

export type PostStatus = 'published' | 'draft' | 'review'

export type MessageStatus = 'pending' | 'replied' | 'ignored'

export interface AdminPost {
    id: number
    title: string
    category: string
    status: PostStatus
    date: string
    views: number
    summary: string
    color: string
    hasCover: boolean
}

export interface AdminMessage {
    id: number
    name: string
    email: string
    date: string
    content: string
    status: MessageStatus
    color: string
}

export interface AdminNotification {
    id: number
    title: string
    time: string
    unread: boolean
}

export interface SiteSettings {
    siteName: string
    tagline: string
    description: string
    icp: string
    email: string
    qqGroup: string
    dmSpace: string
    announcement: boolean
    messageReview: boolean
    defaultPostStatus: PostStatus
    sessionDays: number
}

// ---------- 概览统计 ----------

export const adminStats = {
    posts: 47,
    postsDelta: 12.4,
    views: 12864,
    viewsDelta: 8.2,
    messages: 128,
    messagesDelta: 21.7,
    pending: 6,
    pendingDelta: -33.3
}

export const visitSeries = [
    {label: '周一', value: 486},
    {label: '周二', value: 528},
    {label: '周三', value: 447},
    {label: '周四', value: 613},
    {label: '周五', value: 592},
    {label: '周六', value: 761},
    {label: '周日', value: 830}
]

export const categoryShare = [
    {name: '协会公告', value: 18, color: '#c2f970'},
    {name: '社区共创', value: 12, color: '#a6c6e5'},
    {name: '技术分享', value: 10, color: '#e4b397'},
    {name: '活动回顾', value: 7, color: '#c5b6e9'}
]

export const sparklinePosts = [22, 28, 25, 33, 30, 38, 36, 44, 41, 47]
export const sparklineViews = [8.2, 8.6, 8.4, 9.1, 9.6, 9.3, 10.2, 11.0, 11.6, 12.9]
export const sparklineMessages = [14, 18, 17, 21, 24, 26, 25, 30, 33, 38]
export const sparklinePending = [9, 11, 8, 7, 6, 8, 7, 5, 6, 6]

// ---------- 文章 ----------

export const mockPosts: AdminPost[] = [
    {
        id: 1, title: '不止代码，也一起创造世界。', category: '社区共创', status: 'published',
        date: '2026.11.11', views: 486, summary: 'Minecraft 协会原版服 v1.0.0 更新：更自由的探索，更流畅的体验。',
        color: '#c5d7ad', hasCover: true
    },
    {
        id: 2, title: '在「到梦空间」，找到我们的部落。', category: '协会公告', status: 'published',
        date: '2026.11.08', views: 312, summary: '加入协会部落，接收活动通知，和志同道合的伙伴保持连接。',
        color: '#d0bcaa', hasCover: false
    },
    {
        id: 3, title: '你的技术成长，从一声 Hello 开始。', category: '认识我们', status: 'published',
        date: '2026.09.30', views: 287, summary: 'Web 前端、电脑答疑、竞赛交流。在这里，让好奇心找到同行的人。',
        color: '#a9bf8f', hasCover: false
    },
    {
        id: 4, title: '前端开放夜 · 第一期回顾', category: '活动回顾', status: 'published',
        date: '2026.10.25', views: 421, summary: '第一次线下分享会：从浏览器渲染讲到组件化思维。',
        color: '#c5b6e9', hasCover: true
    },
    {
        id: 5, title: '电脑义诊活动通知', category: '协会公告', status: 'review',
        date: '2026.11.20', views: 0, summary: '下周三晚 19:00，带上你的电脑来信息楼 402。',
        color: '#e4b397', hasCover: false
    },
    {
        id: 6, title: '一起搭一个社团官网', category: '技术分享', status: 'draft',
        date: '2026.11.18', views: 0, summary: '从 0 到 1 的 Nuxt 实战笔记，草稿整理中。',
        color: '#a6c6e5', hasCover: false
    },
    {
        id: 7, title: '社团服务器使用指南', category: '技术分享', status: 'published',
        date: '2026.10.03', views: 534, summary: '连接地址、常用指令与注意事项一文讲清。',
        color: '#9ca2c2', hasCover: true
    },
    {
        id: 8, title: '竞赛组队招募：蓝桥杯', category: '协会公告', status: 'published',
        date: '2026.09.21', views: 398, summary: '寻找队友，一起备赛。群内报名，月底截止。',
        color: '#b6a594', hasCover: false
    },
    {
        id: 9, title: 'CSS 也能做海报？创意练习合集', category: '技术分享', status: 'draft',
        date: '2026.11.15', views: 0, summary: '渐变、网格、剪贴路径——用代码复刻设计感。',
        color: '#8c9f8f', hasCover: false
    },
    {
        id: 10, title: '新生见面会总结', category: '活动回顾', status: 'published',
        date: '2026.09.28', views: 246, summary: '欢迎 36 位新朋友加入，期待下一次见面。',
        color: '#ced9b8', hasCover: true
    }
]

export const postCategories = ['全部', '协会公告', '社区共创', '认识我们', '技术分享', '活动回顾']

// ---------- 留言 ----------

export const mockMessages: AdminMessage[] = [
    {
        id: 1, name: '陈同学', email: 'chen@example.com', date: '2026.11.23 21:14',
        content: '你好，请问 Minecraft 服务器的连接地址在哪里获取？我刚加入协会群，翻了公告没有找到，谢谢！',
        status: 'pending', color: '#c5d7ad'
    },
    {
        id: 2, name: '李同学', email: 'li@example.com', date: '2026.11.23 18:02',
        content: '这学期还会开 Web 前端的入门课吗？完全没有基础也可以参加吗？',
        status: 'pending', color: '#a6c6e5'
    },
    {
        id: 3, name: '王同学', email: 'wang@example.com', date: '2026.11.22 22:47',
        content: '官网做得很好看！想知道这个粒子背景是用什么写的，可以分享一下技术栈吗？',
        status: 'replied', color: '#e4b397'
    },
    {
        id: 4, name: '张同学', email: 'zhang@example.com', date: '2026.11.21 12:30',
        content: '到梦空间扫码加入了部落，之后活动通知都会发在那里吗？还需要关注别的渠道吗？',
        status: 'replied', color: '#c5b6e9'
    },
    {
        id: 5, name: '刘同学', email: 'liu@example.com', date: '2026.11.20 09:15',
        content: '电脑开机后一直蓝屏，代码 0x0000007B，能帮忙看看是什么问题吗？',
        status: 'replied', color: '#9ca2c2'
    },
    {
        id: 6, name: '赵同学', email: 'zhao@example.com', date: '2026.11.18 16:40',
        content: '蓝桥杯组队还缺人吗？我擅长 C++ 和算法，想找一个做 Web 方向的同学互补。',
        status: 'pending', color: '#b6a594'
    },
    {
        id: 7, name: '孙同学', email: 'sun@example.com', date: '2026.11.16 20:22',
        content: '留言测试，顺便问一下下次义诊活动具体地点和时间。',
        status: 'ignored', color: '#8c9f8f'
    },
    {
        id: 8, name: '周同学', email: 'zhou@example.com', date: '2026.11.15 14:08',
        content: '协会招新什么时候开始呀？想拉舍友一起加入。',
        status: 'replied', color: '#ced9b8'
    }
]

// ---------- 通知 ----------

export const notifications: AdminNotification[] = [
    {id: 1, title: '有 3 条新留言等待处理', time: '8 分钟前', unread: true},
    {id: 2, title: '《电脑义诊活动通知》待审核', time: '1 小时前', unread: true},
    {id: 3, title: '本周访问量达到新高', time: '昨天 20:12', unread: true},
    {id: 4, title: '站点备份任务已完成', time: '2 天前', unread: false}
]

// ---------- 站点设置 ----------

export const defaultSettings: SiteSettings = {
    siteName: '信息通信技术协会',
    tagline: '保持好奇，创造可能',
    description: '信息工程学院直属协会。一起探索 Web 开发、计算机技术与创意实践，在分享与协作中，把想法变成现实。',
    icp: '豫ICP备XXXXXXXX号',
    email: 'ict@example.edu.cn',
    qqGroup: '88888888',
    dmSpace: '信息通信技术协会',
    announcement: true,
    messageReview: true,
    defaultPostStatus: 'draft',
    sessionDays: 7
}
