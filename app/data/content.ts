export interface NewsItem {
  slug: string
  category: '社区共创' | '协会公告' | '认识我们'
  date: string
  title: string
  description: string
  paragraphs: string[]
  image?: string
}

// 公告文字与发布日期整理自用户提供的协会资料。
export const news: NewsItem[] = [
  {
    slug: 'minecraft-update-1-0', category: '社区共创', date: '2026.11.11',
    title: '不止代码，也一起创造世界。',
    description: 'Minecraft 协会原版服 v1.0.0 更新：更自由的探索，更流畅的体验。下一块方块，等你来放。',
    image: '/images/minecraft-world.jpg',
    paragraphs: [
      '协会原版服 v1.0.0 更新已发布。我们希望把这里变成一个可以自由探索、协作建造和分享灵感的小世界。',
      '服务端新增 /tpa（传送至其他玩家）、/home（传送回家）、/sethome（设置家）、/back（回到死亡点或上次传送前位置）指令。',
      '可选客户端使用元素周期表模组进行优化，并加入地平线、苹果皮、地图、一键整理和 Iris 光影等模组。你可以按自己的设备情况选择使用。',
      '本次公告发布时，地平线服务端与客户端版本暂不匹配，后续适配以协会群内通知为准。连接地址、客户端文件和实时服务器状态请在协会群内获取。'
    ]
  },
  {
    slug: 'join-our-tribe', category: '协会公告', date: '2026.11.08',
    title: '在「到梦空间」，找到我们的部落。',
    description: '加入协会部落，接收活动通知，和志同道合的伙伴保持连接。',
    paragraphs: [
      '协会已在「到梦空间」建立部落。打开到梦空间，通过扫码或搜索“信息通信技术协会”即可找到我们。',
      '加入部落后，便于接收和参与协会后续活动。活动报名、请假与学分认定等具体安排，请以学校平台及每次活动的正式通知为准。',
      '新朋友可以先浏览协会介绍，了解我们的学习方向和日常交流内容，再通过加入页面的二维码找到组织。'
    ]
  },
  {
    slug: 'hello-ict', category: '认识我们', date: '2026.09.30',
    title: '你的技术成长，从一声 Hello 开始。',
    description: 'Web 前端、电脑答疑、竞赛交流。在这里，让好奇心找到同行的人。',
    paragraphs: [
      '信息通信技术协会是信息工程学院直属协会。我们以“打造精品协会，弘扬计算机应用技术”为目标，以“构建计算机学习平台，提升实操能力”为服务理念。',
      '日常教学主要围绕 Web 前端开发与设计展开。在协会群内，大家也可以交流计算机、网络设备的使用和维护问题，在解决问题的过程中理解原理。',
      '协会有参与信息学院相关比赛的学长学姐。对竞赛感兴趣的同学，可以在群内主动交流、寻找伙伴，了解合适的参赛方向。',
      '我们相信，技术成长不必独自摸索。无论你是刚开始写第一行代码，还是已经有了自己的小作品，都欢迎一起分享、探索与实践。'
    ]
  }
]

export const directions = [
  { id: 'web', number: '01', icon: 'code', title: 'Web 开发', en: 'BUILD THE WEB', description: '从第一行 HTML，到可交互的完整作品。让每一个想法，都能在浏览器里发生。', tags: ['Vue / Nuxt', '创意交互', '前端工程'], color: 'green', lessons: ['HTML 与 CSS：搭建你的第一张网页', 'JavaScript：让页面回应你的操作', 'Vue 与 Nuxt：把想法组织成应用', '作品打磨：性能、可访问性与发布'] },
  { id: 'hardware', number: '02', icon: 'cpu', title: '硬件与网络', en: 'UNDER THE HOOD', description: '拆解问题，也探索原理。一起了解计算机与网络，让技术真正解决身边的小事。', tags: ['电脑答疑', '设备维护', '网络基础'], color: 'blue', lessons: ['了解计算机硬件与系统组成', '梳理故障现象与排查思路', '学习设备维护与数据保护', '理解局域网、IP 地址与网络连接'] },
  { id: 'competition', number: '03', icon: 'trophy', title: '竞赛与实践', en: 'CHALLENGE YOURSELF', description: '和有经验的伙伴一起，把知识带到真实挑战中。走出舒适区，做一点不一样的东西。', tags: ['经验分享', '组队交流', '项目实践'], color: 'peach', lessons: ['找到适合自己的竞赛与实践方向', '与学长学姐交流参赛经验', '寻找互补的队友，拆解项目任务', '打磨作品表达与展示能力'] },
  { id: 'community', number: '04', icon: 'blocks', title: '玩家与共创', en: 'CREATE TOGETHER', description: '认真写代码，也认真玩。走进我们的 Minecraft 世界，把天马行空变成共同的作品。', tags: ['Minecraft', '协作建造', '灵感碰撞'], color: 'purple', lessons: ['在协会群获取服务器连接与客户端说明', '了解社区规则与基础指令', '探索、建造，分享你的创意', '和伙伴协作完成一片属于我们的世界'] }
]

export const searchItems = [
  { title: '关于协会', description: '我们的理念与成长方向', to: '/about', type: '页面' },
  { title: '探索方向', description: 'Web 开发、硬件、竞赛与共创', to: '/explore', type: '页面' },
  { title: '协会动态', description: '公告与社区更新', to: '/news', type: '页面' },
  { title: '加入我们', description: '到梦空间部落与加入指引', to: '/join', type: '页面' },
  ...news.map(item => ({ title: item.title, description: item.description, to: `/news/${item.slug}`, type: item.category }))
]
