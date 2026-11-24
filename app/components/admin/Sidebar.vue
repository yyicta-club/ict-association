<script setup lang="ts">
const route = useRoute()

const primary = [
    {to: '/admin/overview', label: '概览', icon: 'dashboard'},
    {to: '/admin/posts', label: '文章', icon: 'file'},
    {to: '/admin/messages', label: '留言', icon: 'mail', badge: 6},
    {to: '/admin/settings', label: '设置', icon: 'settings'}
]

function isActive(to: string) {
    return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <aside class="admin-sidebar">
    <NuxtLink to="/admin/overview" class="admin-brand">
      <span class="admin-brand-mark">
        <AdminIcon name="layers" :size="19"/>
      </span>
      <span class="admin-brand-copy">
        <strong>信息通信技术协会</strong>
        <small>ADMIN CONSOLE</small>
      </span>
    </NuxtLink>

    <nav class="admin-nav">
      <div class="admin-nav-group">
        <p class="admin-nav-label">主菜单</p>
        <NuxtLink v-for="(item, index) in primary" :key="item.to" :to="item.to"
                  class="admin-nav-item" :class="{'is-active': isActive(item.to)}"
                  :style="{animationDelay: `${index * 55}ms`}">
          <AdminIcon :name="item.icon" :size="17"/>
          <span>{{ item.label }}</span>
          <span v-if="item.badge" class="admin-nav-badge">{{ item.badge }}</span>
        </NuxtLink>
      </div>

      <div class="admin-nav-group">
        <p class="admin-nav-label">其他</p>
        <a href="/" class="admin-nav-item" style="animation-delay: 220ms">
          <AdminIcon name="external" :size="17"/>
          <span>查看站点</span>
        </a>
        <NuxtLink to="/admin/login" class="admin-nav-item" style="animation-delay: 275ms">
          <AdminIcon name="logout" :size="17"/>
          <span>退出登录</span>
        </NuxtLink>
      </div>
    </nav>

    <div class="admin-sidebar-foot">
      <div class="admin-user">
        <span class="admin-avatar">管</span>
        <span class="admin-user-copy">
          <strong>协会管理员</strong>
          <small><span class="status-dot"/>在线 · ICT-ADMIN</small>
        </span>
      </div>
    </div>
  </aside>
</template>
