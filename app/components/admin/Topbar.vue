<script setup lang="ts">
import {notifications} from '~/data/admin'

const emit = defineEmits<{ toggle: [] }>()

const route = useRoute()
const {push} = useToast()

const titles: Record<string, {title: string, sub: string}> = {
    '/admin/overview': {title: '概览', sub: 'OVERVIEW'},
    '/admin/posts': {title: '文章管理', sub: 'POSTS'},
    '/admin/messages': {title: '留言管理', sub: 'MESSAGES'},
    '/admin/settings': {title: '站点设置', sub: 'SETTINGS'}
}

const current = computed(() => titles[route.path] || {title: '管理后台', sub: 'CONSOLE'})

const now = ref('')
let timer: ReturnType<typeof setInterval> | undefined

function tick() {
    const date = new Date()
    now.value = date.toLocaleTimeString('zh-CN', {hour12: false})
}

onMounted(() => {
    tick()
    timer = setInterval(tick, 1000)
})
onUnmounted(() => clearInterval(timer))

const showNotify = ref(false)
const notifyRoot = ref<HTMLElement | null>(null)

function onDocClick(event: MouseEvent) {
    if (notifyRoot.value && !notifyRoot.value.contains(event.target as Node)) {
        showNotify.value = false
    }
}

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

const unread = computed(() => notifications.filter(item => item.unread).length)

function markAllRead() {
    notifications.forEach(item => {
        item.unread = false
    })
    push({type: 'success', title: '已全部标记为已读', description: '演示模式 · 未接入后端'})
}
</script>

<template>
  <header class="admin-topbar">
    <div class="admin-topbar-left">
      <button class="admin-burger" type="button" aria-label="打开菜单" @click="emit('toggle')">
        <AdminIcon name="menu" :size="17"/>
      </button>
      <div class="admin-topbar-title" :key="route.path">
        <strong>{{ current.title }}</strong>
        <small>{{ current.sub }}</small>
      </div>
    </div>

    <div class="admin-topbar-right">
      <label class="admin-search">
        <AdminIcon name="search" :size="15"/>
        <input type="search" placeholder="搜索文章、留言…">
      </label>

      <span class="admin-clock"><b>{{ now || '--:--:--' }}</b></span>

      <div ref="notifyRoot" style="position: relative">
        <button class="admin-icon-btn" type="button" aria-label="通知" @click="showNotify = !showNotify">
          <AdminIcon name="bell" :size="16"/>
          <span v-if="unread" class="admin-dot-badge">{{ unread }}</span>
        </button>

        <Transition name="admin-drop">
          <div v-if="showNotify" class="admin-notify-panel">
            <div class="admin-notify-head">
              <span>通知</span>
              <button class="mono" type="button" style="color: var(--lime)" @click="markAllRead">全部已读</button>
            </div>
            <ul class="admin-notify-list">
              <li v-for="item in notifications" :key="item.id" :class="{'is-unread': item.unread}">
                <a href="#" @click.prevent="showNotify = false">
                  <p>{{ item.title }}</p>
                  <small>{{ item.time }}</small>
                </a>
              </li>
            </ul>
          </div>
        </Transition>
      </div>

      <span class="admin-avatar is-square" title="协会管理员">管</span>
    </div>
  </header>
</template>
