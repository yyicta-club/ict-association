<script setup lang="ts">
import type {AdminPost, PostStatus} from '~/data/admin'
import {mockPosts, postCategories} from '~/data/admin'

definePageMeta({layout: 'admin'})

useHead({title: '文章管理 · 管理后台 · 信息通信技术协会'})

const {push} = useToast()

const posts = ref<AdminPost[]>([...mockPosts])
const keyword = ref('')
const category = ref('全部')
const status = ref<'全部' | PostStatus>('全部')
const selected = ref<number[]>([])
const removing = ref<number[]>([])

const drawerOpen = ref(false)
const saving = ref(false)

const form = reactive({
    title: '',
    category: '协会公告',
    status: 'draft' as PostStatus,
    summary: ''
})

const statusOptions: {label: string, value: '全部' | PostStatus}[] = [
    {label: '全部状态', value: '全部'},
    {label: '已发布', value: 'published'},
    {label: '待审核', value: 'review'},
    {label: '草稿', value: 'draft'}
]

const filtered = computed(() => posts.value.filter(post => {
    const matchKeyword = !keyword.value.trim()
        || post.title.includes(keyword.value.trim())
        || post.summary.includes(keyword.value.trim())
    const matchCategory = category.value === '全部' || post.category === category.value
    const matchStatus = status.value === '全部' || post.status === status.value
    return matchKeyword && matchCategory && matchStatus
}))

const allChecked = computed({
    get: () => filtered.value.length > 0 && filtered.value.every(post => selected.value.includes(post.id)),
    set: value => {
        selected.value = value
            ? [...new Set([...selected.value, ...filtered.value.map(post => post.id)])]
            : selected.value.filter(id => !filtered.value.some(post => post.id === id))
    }
})

function toggleRow(id: number) {
    selected.value = selected.value.includes(id)
        ? selected.value.filter(item => item !== id)
        : [...selected.value, id]
}

function removePosts(ids: number[]) {
    removing.value = ids
    setTimeout(() => {
        posts.value = posts.value.filter(post => !ids.includes(post.id))
        selected.value = selected.value.filter(id => !ids.includes(id))
        removing.value = []
        push({type: 'success', title: `已删除 ${ids.length} 篇文章`, description: '演示模式 · 未接入后端'})
    }, 320)
}

function bulkDelete() {
    if (!selected.value.length) return
    removePosts([...selected.value])
}

function openDrawer() {
    form.title = ''
    form.category = '协会公告'
    form.status = 'draft'
    form.summary = ''
    drawerOpen.value = true
}

function savePost() {
    if (!form.title.trim()) {
        push({type: 'error', title: '请填写文章标题'})
        return
    }
    saving.value = true
    setTimeout(() => {
        saving.value = false
        drawerOpen.value = false
        posts.value.unshift({
            id: Math.max(...posts.value.map(post => post.id), 0) + 1,
            title: form.title.trim(),
            category: form.category,
            status: form.status,
            date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'),
            views: 0,
            summary: form.summary.trim() || '暂无摘要。',
            color: '#c5d7ad',
            hasCover: false
        })
        push({type: 'success', title: '文章已保存', description: '演示模式 · 未接入后端'})
    }, 900)
}

function resetFilters() {
    keyword.value = ''
    category.value = '全部'
    status.value = '全部'
}
</script>

<template>
  <div>
    <header class="admin-page-head">
      <div>
        <p class="eyebrow">
          <span class="section-number">02</span>
          <span class="mono">POSTS</span>
        </p>
        <h1>文章管理</h1>
        <p>管理协会公告、社区共创与技术分享文章。当前为演示数据，未接入后端。</p>
      </div>
      <div class="admin-page-actions">
        <button class="admin-btn is-primary" type="button" @click="openDrawer">
          <AdminIcon name="plus" :size="15"/>
          新建文章
        </button>
      </div>
    </header>

    <div class="admin-toolbar">
      <label class="admin-field is-wide">
        <AdminIcon name="search" :size="14"/>
        <input v-model="keyword" class="is-wide" type="search" placeholder="搜索标题或摘要…">
      </label>

      <label class="admin-field">
        <AdminIcon name="filter" :size="14"/>
        <select v-model="category">
          <option v-for="item in postCategories" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>

      <label class="admin-field">
        <AdminIcon name="layers" :size="14"/>
        <select v-model="status">
          <option v-for="item in statusOptions" :key="item.value" :value="item.value">{{ item.label }}</option>
        </select>
      </label>

      <span class="admin-toolbar-spacer"/>
      <span class="mono muted">{{ filtered.length }} / {{ posts.length }} 篇</span>
    </div>

    <Transition name="admin-fade">
      <div v-if="selected.length" class="admin-bulkbar">
        <AdminIcon name="check" :size="15"/>
        已选择 <b>{{ selected.length }}</b> 篇文章
        <span class="admin-toolbar-spacer"/>
        <button class="admin-btn is-sm is-danger" type="button" @click="bulkDelete">
          <AdminIcon name="trash" :size="13"/>
          批量删除
        </button>
        <button class="admin-btn is-sm is-ghost" type="button" @click="selected = []">取消选择</button>
      </div>
    </Transition>

    <article class="admin-panel">
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
          <tr>
            <th class="col-narrow">
              <input v-model="allChecked" class="admin-check" type="checkbox" aria-label="全选">
            </th>
            <th>标题</th>
            <th>分类</th>
            <th>状态</th>
            <th>发布日期</th>
            <th>浏览量</th>
            <th class="col-actions">操作</th>
          </tr>
          </thead>
          <tbody>
          <tr v-for="(post, index) in filtered" :key="post.id" :class="{'is-removing': removing.includes(post.id)}"
              :style="{animationDelay: `${index * 40}ms`}">
            <td>
              <input class="admin-check" type="checkbox" :checked="selected.includes(post.id)"
                     :aria-label="`选择 ${post.title}`" @change="toggleRow(post.id)">
            </td>
            <td>
              <div class="admin-post-cell">
                <span class="admin-post-thumb" :style="{background: post.color}">
                  {{ post.hasCover ? 'IMG' : post.category.slice(0, 2) }}
                </span>
                <span class="admin-post-copy">
                  <strong>{{ post.title }}</strong>
                  <small>{{ post.summary }}</small>
                </span>
              </div>
            </td>
            <td><span class="admin-tag is-grey">{{ post.category }}</span></td>
            <td><AdminStatusBadge :status="post.status"/></td>
            <td><span class="admin-muted-num">{{ post.date }}</span></td>
            <td><span class="admin-muted-num">{{ post.views.toLocaleString() }}</span></td>
            <td class="col-actions">
              <span class="admin-row-actions">
                <button class="admin-row-btn" type="button" title="编辑" aria-label="编辑"
                        @click="push({type: 'info', title: '编辑功能待接入后端'})">
                  <AdminIcon name="edit" :size="13"/>
                </button>
                <button class="admin-row-btn is-danger" type="button" title="删除" aria-label="删除"
                        @click="removePosts([post.id])">
                  <AdminIcon name="trash" :size="13"/>
                </button>
              </span>
            </td>
          </tr>
          </tbody>
        </table>
      </div>

      <div v-if="!filtered.length" class="admin-empty">
        <AdminIcon name="inbox" :size="34"/>
        <strong>没有找到匹配的文章</strong>
        <p>试试更换关键词或筛选条件。</p>
        <button class="admin-btn is-sm" type="button" style="margin-top: 16px" @click="resetFilters">重置筛选</button>
      </div>

      <footer class="admin-table-foot">
        <span class="mono muted">共 {{ filtered.length }} 条 · 第 1 / 1 页</span>
        <div class="admin-pagination">
          <button class="admin-page-btn" type="button" disabled>‹</button>
          <button class="admin-page-btn is-active" type="button">1</button>
          <button class="admin-page-btn" type="button" disabled>›</button>
        </div>
      </footer>
    </article>

    <AdminSlideOver v-model="drawerOpen" title="新建文章" description="填写基本信息后保存（演示模式，不写入后端）">
      <div class="admin-form-group">
        <label for="post-title">文章标题</label>
        <input id="post-title" v-model="form.title" class="admin-input" type="text" placeholder="例如：不止代码，也一起创造世界。">
      </div>

      <div class="admin-form-group">
        <label for="post-category">所属分类</label>
        <select id="post-category" v-model="form.category" class="admin-input">
          <option v-for="item in postCategories.slice(1)" :key="item" :value="item">{{ item }}</option>
        </select>
      </div>

      <div class="admin-form-group">
        <label>发布状态</label>
        <div class="admin-segmented">
          <button v-for="item in statusOptions.slice(1)" :key="item.value" type="button"
                  :class="{'is-active': form.status === item.value}" @click="form.status = item.value as PostStatus">
            {{ item.label }}
          </button>
        </div>
      </div>

      <div class="admin-form-group">
        <label for="post-summary">文章摘要</label>
        <textarea id="post-summary" v-model="form.summary" class="admin-input"
                  placeholder="用一两句话概括这篇文章…"/>
      </div>

      <div class="admin-form-group">
        <label>封面</label>
        <div class="admin-cover-picker">
          <span class="admin-cover-thumb" style="background: #c5d7ad">IMG</span>
          <span>
            上传封面图
            <small>支持 JPG / PNG · 建议 1200 × 800</small>
          </span>
        </div>
      </div>

      <template #footer>
        <button class="admin-btn" type="button" @click="drawerOpen = false">取消</button>
        <button class="admin-btn is-primary" type="button" :disabled="saving" @click="savePost">
          <span v-if="saving" class="admin-spinner"/>
          <AdminIcon v-else name="check" :size="15"/>
          {{ saving ? '保存中…' : '保存文章' }}
        </button>
      </template>
    </AdminSlideOver>
  </div>
</template>
