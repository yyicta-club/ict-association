<script setup lang="ts">
const open = ref(false)
const route = useRoute()

watch(() => route.path, () => {
    open.value = false
})
</script>

<template>
  <div class="admin-shell">
    <AdminSidebar :class="{'is-open': open}"/>

    <Transition name="admin-fade">
      <div v-if="open" class="admin-sidebar-mask" @click="open = false"/>
    </Transition>

    <div class="admin-main">
      <AdminTopbar @toggle="open = !open"/>
      <main class="admin-content">
        <slot/>
      </main>
    </div>

    <nav class="admin-bottom-nav">
      <NuxtLink v-for="item in [
        {to: '/admin/overview', label: '概览', icon: 'dashboard'},
        {to: '/admin/posts', label: '文章', icon: 'file'},
        {to: '/admin/messages', label: '留言', icon: 'mail'},
        {to: '/admin/settings', label: '设置', icon: 'settings'}
      ]" :key="item.to" :to="item.to"
                :class="{'is-active': route.path.startsWith(item.to)}">
        <AdminIcon :name="item.icon" :size="17"/>
        <span>{{ item.label }}</span>
      </NuxtLink>
    </nav>

    <AdminToastHost/>
  </div>
</template>
