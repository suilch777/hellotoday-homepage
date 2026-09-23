const menuToggle = document.querySelector('.menu-toggle');
const navigation = document.querySelector('.nav');
if (menuToggle && navigation) {
  menuToggle.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    navigation.classList.toggle('open', open);
  });
  navigation.addEventListener('click', event => {
    if (event.target.closest('a')) {
      menuToggle.setAttribute('aria-expanded', 'false');
      navigation.classList.remove('open');
    }
  });
}

const menuContent = {
  institution: {
    overview: ['대상자 현황', '기관에 연결된 대상자의 안부 확인 상태를 한곳에서 살펴보는 메뉴입니다.', ['대상자별 오늘의 안부 확인 여부', '최근 확인 시각과 확인 방법', '담당자별 조회 범위']],
    checkins: ['안부 지연 확인', '예정된 시간에 안부가 확인되지 않은 대상자를 살펴보는 메뉴입니다.', ['미확인 대상자 목록', '재확인 요청과 처리 상태', '담당자 확인 이력']],
    help: ['도움 요청', '대상자가 보낸 도움 요청을 확인하고 대응을 기록하는 메뉴입니다.', ['요청 시각과 처리 상태', '보호자 연락 여부', '접근 권한에 따른 위치정보 표시']],
    staff: ['담당자 배정', '기관 내 담당자와 대상자의 연결을 관리하는 메뉴입니다.', ['담당자별 배정 현황', '대상자 연결 요청', '배정 변경 이력']],
    settings: ['기관 설정', '기관 정보와 내부 운영 기준을 관리하는 메뉴입니다.', ['기관 기본 정보', '담당자 계정 관리', '알림 및 접근 범위 설정']]
  },
  operator: {
    overview: ['운영 현황', '기관 이용 현황과 서비스 운영 상태를 점검하는 메뉴입니다.', ['기관별 서비스 이용 현황', '안부 확인 및 도움 요청 처리 현황', '알림 발송 상태']],
    institutions: ['기관 계정', '기관의 가입과 이용 상태를 관리하는 메뉴입니다.', ['기관 신청 및 승인', '기관별 사용 상태', '기관 담당자 계정']],
    permissions: ['접근 권한', '기관 담당자와 운영자의 권한을 분리해 관리하는 메뉴입니다.', ['역할별 조회 범위', '계정 승인과 비활성화', '권한 변경 기록']],
    notices: ['공지 관리', '앱 이용자와 기관에 전달할 공지를 관리하는 메뉴입니다.', ['공지 작성과 게시', '노출 대상 선택', '게시 기간 설정']],
    history: ['운영 기록', '운영상 확인이 필요한 변경과 발송 기록을 살펴보는 메뉴입니다.', ['주요 계정 변경 이력', '알림 발송 결과', '오류 및 대응 기록']]
  }
};

const portal = document.querySelector('[data-portal]');
if (portal) {
  const tabs = [...portal.querySelectorAll('[role="tab"]')];
  const panel = portal.querySelector('#portal-panel');
  const content = menuContent[portal.dataset.portal];
  function selectTab(tab, focus = false) {
    const next = content?.[tab.dataset.tab];
    if (!next) return;
    tabs.forEach(item => {
      item.setAttribute('aria-selected', String(item === tab));
      item.tabIndex = item === tab ? 0 : -1;
    });
    panel.querySelector('[data-panel-title]').textContent = next[0];
    panel.querySelector('[data-panel-description]').textContent = next[1];
    panel.querySelector('[data-panel-items]').replaceChildren(...next[2].map(value => {
      const li = document.createElement('li');
      li.textContent = value;
      return li;
    }));
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.tabIndex = index === 0 ? 0 : -1;
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const offset = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + offset + tabs.length) % tabs.length;
      selectTab(tabs[nextIndex], true);
    });
  });
}
