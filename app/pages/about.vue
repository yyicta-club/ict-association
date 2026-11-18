<script setup lang="ts">
useSeoMeta({ title: '关于协会 · 信息通信技术协会', description: '信息工程学院直属协会。构建计算机学习平台，提升实操能力，让每一份热爱都能找到同伴。' })
useReveal()
const values = [{ number: '01', title: '好奇，是一切的起点。', body: '不急着给自己贴标签。多问一个为什么，多试一种可能，技术世界永远值得再往前走一步。', icon: 'spark' }, { number: '02', title: '分享，让成长发生。', body: '一个问题、一次经验、一段代码，都可能成为别人前进的起点。我们鼓励提问，也珍视每一次认真回答。', icon: 'users' }, { number: '03', title: '动手，把想法变成作品。', body: '学习使用和维护计算机、网络设备，在实践中理解知识；通过竞赛与活动，提升实操能力和计算机素养。', icon: 'code' }]
</script>

<template>
  <div class="container">
    <section class="page-intro about-intro"><span class="eyebrow">ABOUT US / 认识我们</span><h1>技术让我们相遇。<br /><span class="text-lime">热爱，让我们同行。</span></h1><div class="about-intro-bottom"><p>信息通信技术协会，是信息工程学院直属协会。<br />我们为愿意探索的你，搭建一个共享知识、交流技术、动手实践的平台。</p><span class="mono">CURIOUS MINDS.<br />CONNECTED FUTURES.</span></div></section>
    <section class="mission-panel reveal"><div class="mission-symbol" aria-hidden="true">✳</div><div><span class="eyebrow">OUR MISSION</span><h2>构建计算机学习平台，<br />提升实操能力。</h2><p>以「打造精品协会，弘扬计算机应用技术」为目标，在学习、维护与实践中理解技术，也在彼此支持中收获成长。</p></div></section>
    <section class="section"><div class="section-heading reveal"><div><span class="eyebrow">WHAT WE BELIEVE</span><h2>我们的共识<span class="text-lime">。</span></h2></div><span class="mono muted">LESS ALONE. MORE POSSIBLE.</span></div><div class="values-grid"><article v-for="value in values" :key="value.number" class="value-item reveal"><div class="value-top"><AppIcon :name="value.icon" :size="30" /><span class="mono">{{ value.number }}</span></div><h3>{{ value.title }}</h3><p>{{ value.body }}</p></article></div></section>
    <section class="about-details section reveal"><span class="eyebrow">EVERYDAY AT ICT</span><div><h2>有问题，来聊聊。<br />有想法，来试试。</h2><p>协会日常授课主要围绕 Web 前端开发与设计。我们也在群内交流各种电脑问题，学习计算机与网络设备的使用、维护和排查思路。</p><p>想参加比赛，可以联系有参赛经验的学长学姐；想在代码之外发挥创造力，也可以走进协会的 Minecraft 世界。你不必什么都会，只需要愿意迈出第一步。</p><NuxtLink to="/explore" class="text-link">看看我们在探索什么 <AppIcon name="diagonal" :size="18" /></NuxtLink></div></section>
    <div class="banner-wrapper"><JoinBanner /></div>
  </div>
</template>
