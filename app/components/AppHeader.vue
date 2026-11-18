<script setup lang="ts">
import { searchItems } from '~/data/content'
const route = useRoute()
const mobileOpen = ref(false)
const searchDialog = ref<HTMLDialogElement>()
const searchInput = ref<HTMLInputElement>()
const query = ref('')
const navigation = [
  { label: '首页', to: '/' }, { label: '关于协会', to: '/about' },
  { label: '探索方向', to: '/explore' }, { label: '协会动态', to: '/news' }
]
const results = computed(() => {
  const term = query.value.trim().toLowerCase()
  return searchItems.filter(item => `${item.title} ${item.description}`.toLowerCase().includes(term))
})
function openSearch() {
  mobileOpen.value = false
  searchDialog.value?.showModal()
  nextTick(() => searchInput.value?.focus())
}
function closeSearch() { searchDialog.value?.close(); query.value = '' }
function handleKey(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openSearch() }
  if (event.key === 'Escape') mobileOpen.value = false
}
watch(() => route.fullPath, () => { mobileOpen.value = false; closeSearch() })
onMounted(() => window.addEventListener('keydown', handleKey))
onUnmounted(() => window.removeEventListener('keydown', handleKey))
</script>

<template>
  <header class="site-header">
    <div class="header-inner container">
      <NuxtLink to="/" class="brand" aria-label="信息通信技术协会首页">
        <span class="brand-mark"><AppIcon name="code" :size="24" /></span>
        <span class="brand-copy"><strong>信息通信技术协会<span class="brand-period">.</span></strong><small>INFORMATION & COMMUNICATION TECHNOLOGY</small></span>
      </NuxtLink>
      <nav class="desktop-nav" aria-label="主导航">
        <NuxtLink v-for="item in navigation" :key="item.to" :to="item.to" :class="{ active: item.to === '/' ? route.path === '/' : route.path.startsWith(item.to) }">{{ item.label }}</NuxtLink>
      </nav>
      <div class="header-actions">
        <button class="search-trigger" aria-label="搜索网站（Ctrl K）" @click="openSearch"><AppIcon name="search" :size="18" /><kbd>⌘ K</kbd></button>
        <NuxtLink to="/join" class="button button-small button-outline header-join">加入我们 <AppIcon name="diagonal" :size="16" /></NuxtLink>
        <button class="icon-button mobile-menu-button" :aria-expanded="mobileOpen" aria-controls="mobile-navigation" :aria-label="mobileOpen ? '关闭菜单' : '打开菜单'" @click="mobileOpen = !mobileOpen"><AppIcon :name="mobileOpen ? 'close' : 'menu'" /></button>
      </div>
    </div>
    <nav v-if="mobileOpen" id="mobile-navigation" class="mobile-navigation" aria-label="移动导航">
      <NuxtLink v-for="(item, index) in [...navigation, { label: '加入我们', to: '/join' }]" :key="item.to" :to="item.to"><span class="mono">0{{ index + 1 }}</span>{{ item.label }}<AppIcon name="diagonal" /></NuxtLink>
    </nav>
    <dialog ref="searchDialog" class="search-dialog" aria-label="搜索网站" @click="event => { if (event.target === searchDialog) closeSearch() }" @close="query = ''">
      <div class="search-dialog-inner">
        <div class="search-field"><AppIcon name="search" /><input ref="searchInput" v-model="query" type="search" placeholder="搜索方向、公告、加入方式…" aria-label="搜索关键词" /><button class="icon-button" aria-label="关闭搜索" @click="closeSearch"><AppIcon name="close" /></button></div>
        <p class="search-hint mono">{{ query ? `${results.length} 条结果` : '探索协会 / QUICK LINKS' }}</p>
        <div class="search-results">
          <NuxtLink v-for="item in results" :key="item.to" :to="item.to" @click="closeSearch"><span><small>{{ item.type }}</small><strong>{{ item.title }}</strong><p>{{ item.description }}</p></span><AppIcon name="diagonal" /></NuxtLink>
          <div v-if="!results.length" class="search-empty">暂时没有找到相关内容。<br /><span>试试「Web」「Minecraft」或「加入」。</span></div>
        </div>
        <div class="search-bottom mono">ESC 关闭 <span>保持好奇，总会有所发现。</span></div>
      </div>
    </dialog>
  </header>
</template>
