// 결과 화면 공통 동작: 큰 숫자 세어 올리기, 대안 고르면 요청 문구 바꾸기, 문구 복사. 시안 v4·v5가 함께 쓴다.
(function () {
  var offered = 24;
  function text(h) {
    if (h > offered) return '안녕하세요. 근무시간과 관련해 여쭙고 싶습니다.\n제안해 주신 주 ' + offered + '시간보다 더 일할 수 있는데, 주 ' + h + '시간 정도로 늘릴 수 있을까요?\n가능한 요일과 시간대를 알려 주시면 맞추겠습니다. 감사합니다.';
    if (h < offered) return '안녕하세요. 근무시간과 관련해 여쭙고 싶습니다.\n제 사정상 주 ' + offered + '시간은 어려워서, 주 ' + h + '시간으로 조정할 수 있을까요?\n요일과 시간대는 최대한 맞추겠습니다. 감사합니다.';
    return '안녕하세요. 제안해 주신 주 ' + offered + '시간 조건으로 일하고 싶습니다.\n주휴수당이 시급과 별도로 지급되는지 확인 부탁드립니다. 감사합니다.';
  }
  document.querySelectorAll('.opt').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.opt').forEach(function (x) { x.classList.toggle('on', x === b); });
      document.querySelector('.msg-h').textContent = '주 ' + b.dataset.h + '시간';
      var m = document.querySelector('.msg-text'), t = text(Number(b.dataset.h)); if (window.typeText) window.typeText(m, t); else m.textContent = t;
    });
  });
  var copy = document.querySelector('.copy');
  if (copy) copy.addEventListener('click', function () {
    var t = document.querySelector('.msg-text').textContent;
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { copy.textContent = '복사했어요'; }, function () { copy.textContent = '길게 눌러 복사하세요'; });
  });
})();
