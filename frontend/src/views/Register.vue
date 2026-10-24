<template>
    <section>
      <div class="box">
        <div class="square" style="--i:0;"></div>
        <div class="square" style="--i:1;"></div>
        <div class="square" style="--i:2;"></div>
        <div class="square" style="--i:3;"></div>
        <div class="square" style="--i:4;"></div>
        <div class="square" style="--i:5;"></div>
        
        <div class="container">
          <div class="form">
            <h2>注册系统</h2>
            <form @submit.prevent="register">
              <div class="inputBx">
                <input type="text" v-model="username" required />
                <span>用户名</span>
                <i class="fas fa-user-circle"></i>
              </div>
              <div class="inputBx password">
                <input type="password" v-model="password" minlength="6" required />
                <span>密码（至少 6 位）</span>
                <i class="fas fa-key"></i>
              </div>
              
              <div class="inputBx">
                <input type="submit" value="注 册" />
              </div>
            </form>
            <p>已有账号 <router-link to="/">立即登录</router-link></p>
          </div>
        </div>
      </div>
    </section>
  </template>
  
  <script setup>
import { ref,onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import axios from 'axios';
const username = ref('');
const password = ref('');
const router = useRouter();

const register = async () => {
  try {
    const response = await axios.post('/api/register', {
      username: username.value,
      password: password.value
    });

    const result = response.data;

    if (result.type === 'success') {
      // 身份码（出库码）由服务端自动生成，注册后展示给用户
      try {
        await ElMessageBox.alert(
          `你的出库码为 ${result.identityCode}，也可随时在首页「出库码」中查看，请截图或抄写保存。`,
          '注册成功',
          { confirmButtonText: '去登录', type: 'success' }
        );
      } catch {}
      router.push('/');
    } else {
      ElMessage.warning(result.message || '注册失败，请检查信息');
    }
  } catch (error) {
    ElMessage.error('注册时发生错误，请稍后再试');
    console.error('注册错误:', error);
  }
};

const setVh = () => {
  const vh = window.innerHeight * 0.01;
  document.documentElement.style.setProperty('--vh', `${vh}px`);
};

onMounted(() => {
  setVh();
  window.addEventListener('resize', setVh);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', setVh);
});
</script>

  
  <style scoped>
  @import url("https://fonts.googleapis.com/css2?family=El+Messiri:wght@700&display=swap");
  
  * {
    margin: 0;
    padding: 0;
    font-family: "El Messiri", sans-serif;
  }
  
  body {
    background: #031323;
    overflow: hidden;
  }
  
  section {
  display: flex;
  justify-content: center;
  align-items: center;
  width: 100%;
  height: calc(var(--vh, 1vh) * 100); /* 替代100vh */
  background: linear-gradient(-45deg, #ee7752, #e73c7e, #23a6d5, #23d5ab);
  background-size: 400% 400%;
  animation: gradient 10s ease infinite;
  overflow: hidden;
}
  @keyframes gradient {
    0% {
      background-position: 0% 50%;
    }
    50% {
      background-position: 100% 50%;
    }
    100% {
      background-position: 0% 50%;
    }
  }
  
  .box {
    position: relative;
  }
  
  .square {
    position: absolute;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    box-shadow: 0 25px 45px rgba(0, 0, 0, 0.1);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 15px;
    animation: square 10s linear infinite;
    animation-delay: calc(-1s * var(--i));
  }
  
  @keyframes square {
    0%,
    100% {
      transform: translateY(-20px);
    }
  
    50% {
      transform: translateY(20px);
    }
  }
  
  .square:nth-child(1) {
    width: 100px;
    height: 100px;
    top: -15px;
    right: -45px;
  }
  
  .square:nth-child(2) {
    width: 150px;
    height: 150px;
    top: 105px;
    left: -125px;
    z-index: 2;
  }
  
  .square:nth-child(3) {
    width: 60px;
    height: 60px;
    bottom: 85px;
    right: -45px;
    z-index: 2;
  }
  
  .square:nth-child(4) {
    width: 50px;
    height: 50px;
    bottom: 35px;
    left: -95px;
  }
  
  .square:nth-child(5) {
    width: 50px;
    height: 50px;
    top: -15px;
    left: -25px;
  }
  
  .square:nth-child(6) {
    width: 85px;
    height: 85px;
    top: 165px;
    right: -155px;
    z-index: 2;
  }
  
  .container {
    position: relative;
    padding: 50px;
    width: 260px;
    min-height: 380px;
    display: flex;
    justify-content: center;
    align-items: center;
    background: rgba(255, 255, 255, 0.1);
    backdrop-filter: blur(5px);
    border-radius: 10px;
    box-shadow: 0 25px 45px rgba(0, 0, 0, 0.2);
  }
  
  .container::after {
    content: "";
    position: absolute;
    top: 5px;
    right: 5px;
    bottom: 5px;
    left: 5px;
    border-radius: 5px;
    pointer-events: none;
    background: linear-gradient(to bottom, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.1) 2%);
  }
  
  .form {
    position: relative;
    width: 100%;
    height: 100%;
  }
  
  h2 {
    color: #fff;
    letter-spacing: 2px;
    margin-bottom: 30px;
  }
  
  .inputBx {
    position: relative;
    width: 100%;
    margin-bottom: 20px;
  }
  
  .inputBx input {
    width: 80%;
    outline: none;
    border: none;
    border: 1px solid rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.2);
    padding: 8px 10px;
    padding-left: 40px;
    border-radius: 15px;
    color: #fff;
    font-size: 16px;
    box-shadow: 0 5px 15px rgba(0, 0, 0, 0.05);
  }
  
  .password-control {
    position: absolute;
    top: 11px;
    right: 10px;
    display: inline-block;
    width: 20px;
    height: 20px;
    cursor: pointer;
  }
  
  .fas {
    position: absolute;
    top: 13px;
    left: 13px;
  }
  
  label {
    position: absolute;
    top: 10px;
    left: 10px;
    font-size: 18px;
    color: rgba(255, 255, 255, 0.6);
  }
  
  input[type="checkbox"] {
    margin-right: 10px;
  }
  
  
  
  p {
    color: #fff;
    font-size: 15px;
    margin-top: 5px;
  }
  
  a {
    color: #fff;
  }
  span{
    color: #fff;
    font-size: 15px;
    margin-top: 5px;
  }
  
  a:hover {
    background-color: #000;
    background-image: linear-gradient(to right, #434343 0%, black 100%);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  </style>
  
  