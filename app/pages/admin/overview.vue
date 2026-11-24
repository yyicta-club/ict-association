<script setup lang="ts">
import {
    adminStats,
    categoryShare,
    mockMessages,
    mockPosts,
    sparklineMessages,
    sparklinePending,
    sparklinePosts,
    sparklineViews,
    visitSeries
} from '~/data/admin'

definePageMeta({layout: 'admin'})

useHead({title: '概览 · 管理后台 · 信息通信技术协会'})

const {push} = useToast()

const stats = computed(() => [
    {
        label: 'POSTS', caption: '累计发布文章', value: adminStats.posts, delta: adminStats.postsDelta,
        icon: 'file', tone: '#c2f970', series: sparklinePosts
    },
    {
        label: 'VIEWS', caption: '近 30 日浏览量', value: adminStats.views, delta: adminStats.viewsDelta,
        icon: 'chart', tone: '#a6c6e5', series: sparklineViews
    },
    {
        label: 'MESSAGES', caption: '累计收到留言', value: adminStats.messages, delta: adminStats.messagesDelta,
        icon: 'mail', tone: '#e4b397', series: sparklineMessages
    },
    {
        label: 'PENDING', caption: '待处理留言', value: adminStats.pending, delta: adminStats.pendingDelta,
        icon: 'inbox', tone: '#c5b6e9', series: sparklinePending, invert: true
    }
])

const moved = computed(() => {
    const source = [
        {name: '不止代码，也一起创造世界。', meta: '486 次浏览'},
        {name: '在「到梦空间」，找到我们的部落。', meta: '312 次浏览'},
        {name: '前端开放夜 · 第一期回顾', meta: '421 次浏览'},
        {name: '你的技术成长，从一声 Hello 开始。', meta: '287 次浏览'},
        {name: '社团服务器使用指南', meta: '534 次浏览'}
    ]
    return source
})

const recentPosts = computed(() => mockPosts.slice(0, 5))
const recentMessages = computed(() => mockMessages.slice(0, 4))

const timestamp = ref('')
onMounted(() => {
    timestamp.value = new Date().toLocaleString('zh-CN', {hour12: false})
})

function exportReport() {
    push({type: 'info', title: '已生成演示报表', description: '演示模式 · 未接入后端'})
}
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div>
        <p class="eyebrow">
          <span class="section-number">01</span>
          <span class="mono">OVERVIEW</span>
          <span class="eyebrow-divider"/>
          <span class="mono">{{ timestamp }}</span>
        </p>
        <h1>概览</h1>
        <p>协会内容与访客互动的整体表现。所有指标为演示数据，未接入后端。</p>
      </div>
      <div class="admin-page-actions">
        <button class="admin-btn" type="button" @click="exportReport">
          <AdminIcon name="download" :size="15"/>
          导出报表
        </button>
        <NuxtLink to="/admin/posts" class="admin-btn is-primary">
          <AdminIcon name="plus" :size="15"/>
          新建文章
        </NuxtLink>
      </div>
    </header>

    <section class="admin-grid admin-grid-4">
      <AdminStatCard v-for="(stat, index) in stats" :key="stat.label" v-bind="stat"
                     :style="{animationDelay: `${index * 70}ms`, animation: 'admin-rise .55s ease both'}"/>
    </section>

    <section class="admin-grid admin-grid-21" style="margin-top: 20px">
      <article class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>近 7 日访问趋势</h2>
            <p>演示序列 · 悬停查看具体数值</p>
          </div>
          <span class="mono muted">LAST 7 DAYS</span>
        </div>
        <div class="admin-panel-body">
          <AdminChartLine :series="visitSeries" :height="220"/>
        </div>
      </article>

      <article class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>文章分类分布</h2>
            <p>按内容分类统计</p>
          </div>
        </div>
        <div class="admin-panel-body">
          <AdminChartDonut :items="categoryShare" unit="篇"/>
        </div>
      </article>
    </section>

    <section class="admin-grid admin-grid-2" style="margin-top: 20px">
      <article class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>最近发布</h2>
            <p>最新更新的协会文章</p>
          </div>
          <NuxtLink to="/admin/posts" class="admin-btn is-sm is-ghost">
            查看全部
            <AdminIcon name="chevron" :size="13"/>
          </NuxtLink>
        </div>
        <div class="admin-panel-body">
          <div class="admin-feed">
            <div v-for="(post, index) in recentPosts" :key="post.id" class="admin-feed-item"
                 :style="{animationDelay: `${index * 60}ms`}">
              <span class="admin-feed-dot"/>
              <div class="admin-feed-copy">
                <p><b>{{ post.title }}</b></p>
                <small>{{ post.date }} · {{ post.category }} · {{ post.views }} 次浏览</small>
              </div>
              <AdminStatusBadge :status="post.status"/>
            </div>
          </div>
        </div>
      </article>

      <article class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>最新留言</h2>
            <p>待处理的访客留言</p>
          </div>
          <NuxtLink to="/admin/messages" class="admin-btn is-sm is-ghost">
            查看全部
            <AdminIcon name="chevron" :size="13"/>
          </NuxtLink>
        </div>
        <div class="admin-panel-body">
          <div class="admin-feed">
            <div v-for="(message, index) in recentMessages" :key="message.id" class="admin-feed-item"
                 :style="{animationDelay: `${index * 60}ms`}">
              <span class="admin-feed-dot" :style="{'--tone': message.color}"/>
              <div class="admin-feed-copy">
                <p><b>{{ message.name }}</b> {{ message.content }}</p>
                <small>{{ message.date }}</small>
              </div>
              <AdminStatusBadge :status="message.status"/>
            </div>
          </div>
        </div>
      </article>
    </section>

    <section class="admin-grid admin-grid-21" style="margin-top: 20px">
      <article class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>热读文章</h2>
            <p>按浏览量排序</p>
          </div>
          <span class="mono muted">TOP 5</span>
        </div>
        <div class="admin-panel-body">
          <div class="admin-moved">
            <div v-for="(item, index) in moved" :key="item.name" class="admin-moved-item"
                 :style="{animationDelay: `${index * 60}ms`}">
              <span class="admin-moved-rank">{{ index + 1 }}</span>
              <span class="admin-moved-name">{{ item.name }}</span>
              <span class="admin-moved-meta">{{ item.meta }}</span>
            </div>
          </div>
        </div>
      </article>

      <article class="admin-panel">
        <div class="admin-panel-head">
          <div>
            <h2>快捷操作</h2>
            <p>常用的后台动作</p>
          </div>
        </div>
        <div class="admin-panel-body">
          <div class="admin-quick-grid">
            <NuxtLink to="/admin/posts" class="admin-quick">
              <span class="admin-quick-icon"><AdminIcon name="plus" :size="15"/></span>
              <span>新建文章<small>CREATE</small></span>
            </NuxtLink>
            <NuxtLink to="/admin/messages" class="admin-quick">
              <span class="admin-quick-icon"><AdminIcon name="mail" :size="15"/></span>
              <span>处理留言<small>INBOX</small></span>
            </NuxtLink>
            <NuxtLink to="/admin/settings" class="admin-quick">
              <span class="admin-quick-icon"><AdminIcon name="settings" :size="15"/></span>
              <span>站点设置<small>CONFIG</small></span>
            </NuxtLink>
            <a href="/" class="admin-quick">
              <span class="admin-quick-icon"><AdminIcon name="globe" :size="15"/></span>
              <span>访问前台<small>SITE</small></span>
            </a>
          </div>
        </div>
      </article>
    </section>
  </div>
</template>
