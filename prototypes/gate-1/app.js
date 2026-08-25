const views = document.querySelectorAll('.view');
const navItems = document.querySelectorAll('.nav-item');

navItems.forEach((button) => {
  button.addEventListener('click', () => {
    navItems.forEach((item) => item.classList.remove('active'));
    views.forEach((view) => view.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(button.dataset.view).classList.add('active');
  });
});

const approvalDialog = document.getElementById('approvalDialog');
const systemDialog = document.getElementById('systemDialog');

document.querySelectorAll('.approval-trigger, #approvalButton').forEach((button) => {
  button.addEventListener('click', () => approvalDialog.showModal());
});

document.getElementById('systemStatus').addEventListener('click', () => systemDialog.showModal());

document.querySelectorAll('.dialog-close').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

document.getElementById('approve').addEventListener('click', () => {
  approvalDialog.close();
  document.getElementById('approvalButton').textContent = '运行已批准';
  document.getElementById('approvalButton').style.color = '#287657';
  document.getElementById('approvalButton').style.background = '#e4f4eb';
});

document.querySelectorAll('.canvas-node').forEach((node) => {
  node.addEventListener('click', (event) => {
    if (event.target.closest('button')) return;
    document.querySelectorAll('.canvas-node').forEach((item) => item.classList.remove('selected'));
    node.classList.add('selected');
    document.querySelector('.canvas-detail h3').textContent = node.dataset.node;
  });
});

document.querySelectorAll('.quote-node').forEach((button) => {
  button.addEventListener('click', () => {
    const node = button.closest('.canvas-node');
    node.classList.toggle('quoted');
    button.classList.toggle('active');
    button.textContent = node.classList.contains('quoted') ? '✓ 已引用' : '＋ 引用';
  });
});

document.querySelectorAll('.follow-node').forEach((button) => {
  button.addEventListener('click', () => {
    const node = button.closest('.canvas-node');
    document.querySelectorAll('.canvas-node').forEach((item) => item.classList.remove('selected'));
    node.classList.add('selected');
    document.querySelector('.mode-switch [data-mode="follow"]').click();
    document.querySelector('.canvas-composer textarea').focus();
  });
});

document.querySelectorAll('.mode-switch button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.mode-switch button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    document.querySelector('.quote-tray').style.display = button.dataset.mode === 'quote' ? 'flex' : 'none';
  });
});

const batchButton = document.querySelector('.batch-button');
batchButton.addEventListener('click', () => {
  const next = { '×1': '×2', '×2': '×4', '×4': '×1' }[batchButton.textContent];
  batchButton.textContent = next;
});

document.getElementById('freeNodeButton').addEventListener('click', () => {
  const note = document.querySelector('.free-node');
  note.animate([{ transform: 'scale(.96)', opacity: .5 }, { transform: 'scale(1)', opacity: 1 }], { duration: 260 });
});

document.getElementById('organizeButton').addEventListener('click', () => {
  document.querySelector('.canvas-stage').classList.toggle('organized');
});
