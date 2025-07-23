document.addEventListener('DOMContentLoaded', function() {
  // DOM Elements
  const composeBtn = document.querySelector('.compose-btn');
  const composeModal = document.getElementById('composeModal');
  const closeBtn = document.querySelector('.close-btn');
  const composeForm = document.getElementById('composeForm');
  const emailList = document.getElementById('emailList');
  const emailView = document.getElementById('emailView');
  const htmlContent = document.getElementById('htmlContent');
  const bodyContent = document.getElementById('body');
  const attachmentsInput = document.getElementById('attachments');
  const toggleBtns = document.querySelectorAll('.toggle-btn');
  
  let currentAttachments = [];
  let currentView = 'text'; // 'text' or 'html'
  let apiAvailable = true;

  // Mock data
  const mockInbox = [
    {
      id: 1,
      from: 'support@company.com',
      replyTo: 'support@company.com',
      subject: 'Welcome to our service!',
      date: new Date().toISOString(),
      body: 'Thank you for signing up to our service. We are excited to have you on board!',
      unread: true
    },
    {
      id: 2,
      from: 'newsletter@company.com',
      subject: 'Weekly Newsletter',
      date: new Date(Date.now() - 86400000).toISOString(),
      body: 'Check out our latest products and offers this week!',
      unread: false
    }
  ];

  // Load inbox emails
  loadInbox();
  
  // Event listeners
  composeBtn.addEventListener('click', function() {
    composeModal.style.display = 'block';
    document.getElementById('from').focus();
  });
  
  closeBtn.addEventListener('click', function() {
    composeModal.style.display = 'none';
    resetComposeForm();
  });
  
  window.addEventListener('click', function(event) {
    if (event.target === composeModal) {
      composeModal.style.display = 'none';
      resetComposeForm();
    }
  });
  
  // Toggle between text and HTML editors
  toggleBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const type = this.getAttribute('data-type');
      
      toggleBtns.forEach(b => b.classList.remove('active'));
      this.classList.add('active');
      
      if (type === 'html') {
        document.getElementById('text-editor').style.display = 'none';
        document.getElementById('html-editor').style.display = 'block';
        currentView = 'html';
      } else {
        document.getElementById('text-editor').style.display = 'block';
        document.getElementById('html-editor').style.display = 'none';
        currentView = 'text';
      }
    });
  });
  
  // Attachments handler
  attachmentsInput.addEventListener('change', function(e) {
    currentAttachments = Array.from(e.target.files);
    updateAttachmentList();
  });
  
  // Form submission handler
  composeForm.addEventListener('submit', async function(e) {
    e.preventDefault();
    
    // Validate form
    const requiredFields = [
      { element: document.getElementById('from'), name: 'From' },
      { element: document.getElementById('to'), name: 'To' },
      { element: document.getElementById('subject'), name: 'Subject' },
      { element: currentView === 'html' ? htmlContent : bodyContent, name: 'Message' }
    ];
    
    let isValid = true;
    requiredFields.forEach(field => {
      if (!field.element.value.trim()) {
        isValid = false;
        field.element.style.border = '1px solid #ff4444';
        field.element.focus();
        showNotification(`Please fill the ${field.name} field`, 'error');
      } else {
        field.element.style.border = '';
      }
    });
    
    if (!isValid) return;
    
    // Prepare email data with proper headers to avoid spam
    const signature = document.getElementById('signature').value.trim();

    const textBody = bodyContent.value + (signature ? `\n\n${signature}` : '');
    const htmlBody = (currentView === 'html' ? htmlContent.value : `<p>${bodyContent.value.replace(/\n/g, '<br>')}</p>`) +
                    (signature ? `<br><br><p>${signature.replace(/\n/g, '<br>')}</p>` : '');

    const emailData = {
      from: document.getElementById('from').value,
      senderName: document.getElementById('senderName').value || 'YourCompany Team',  
      replyTo: document.getElementById('replyTo').value || document.getElementById('from').value,
      to: document.getElementById('to').value,
      cc: document.getElementById('cc').value,
      bcc: document.getElementById('bcc').value,
      subject: document.getElementById('subject').value,
      text: textBody,
      html: htmlBody,

      headers: {
        'X-Priority': '1',
        'X-Mailer': 'MarketingMailSystem',
        'X-MS-Exchange-Organization-AuthAs': 'Internal',
        'X-MS-Exchange-Organization-AuthMechanism': '04',
        'X-MS-Exchange-Organization-AuthSource': 'https://web-mail-3ooi.onrender.com',
      }
    };

    const formData = new FormData();
    formData.append('data', JSON.stringify(emailData));
    
    if (currentAttachments.length > 0) {
      currentAttachments.forEach(file => {
        formData.append('attachments', file);
      });
    }
    
    try {
      const response = await fetch('https://web-mail-3ooi.onrender.com/api/send', {
        method: 'POST',
        body: formData
      });
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      const result = await response.json();
      
      if (result.success) {
        showNotification('Email sent successfully!', 'success');
        composeModal.style.display = 'none';
        resetComposeForm();
        
        // Refresh inbox after short delay
        setTimeout(() => {
          loadInbox();
        }, 1000);
      } else {
        showNotification(`Error: ${result.error || 'Failed to send email'}`, 'error');
      }
    } catch (error) {
      console.error('Error:', error);
      showNotification('Failed to send email. Please check console for details.', 'error');
    }
  });
  
  // Helper functions
  function updateAttachmentList() {
    const attachmentList = document.getElementById('attachmentList');
    attachmentList.innerHTML = '';
    
    if (currentAttachments.length === 0) {
      attachmentList.style.display = 'none';
      return;
    }
    
    attachmentList.style.display = 'block';
    
    currentAttachments.forEach((file, index) => {
      const item = document.createElement('div');
      item.className = 'attachment-item';
      item.innerHTML = `
        <span>${file.name} (${formatFileSize(file.size)})</span>
        <button class="remove-attachment" data-index="${index}">×</button>
      `;
      attachmentList.appendChild(item);
    });
    
    document.querySelectorAll('.remove-attachment').forEach(btn => {
      btn.addEventListener('click', function() {
        const index = parseInt(this.getAttribute('data-index'));
        currentAttachments.splice(index, 1);
        updateAttachmentList();
      });
    });
  }
  
  function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }
  
  function resetComposeForm() {
    composeForm.reset();
    htmlContent.value = '';
    bodyContent.value = '';
    currentAttachments = [];
    updateAttachmentList();
    
    // Reset to text view
    document.querySelector('.toggle-btn[data-type="text"]').click();
    
    // Reset all field styles
    document.querySelectorAll('input, textarea').forEach(field => {
      field.style.border = '';
    });
  }
  
  function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
      notification.classList.add('show');
    }, 10);
    
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        document.body.removeChild(notification);
      }, 300);
    }, 3000);
  }
  
  function loadInbox() {
    fetch('https://web-mail-3ooi.onrender.com/api/inbox')
      .then(response => {
        if (!response.ok) {
          apiAvailable = false;
          throw new Error('API not available');
        }
        return response.json();
      })
      .then(emails => {
        emails.sort((a, b) => new Date(b.date) - new Date(a.date));
        renderEmails(emails);
      })
      .catch(error => {
        console.warn('Using mock inbox data due to:', error);
        renderEmails(mockInbox);
      });
  }
  
  function renderEmails(emails) {
    emailList.innerHTML = '';
    
    if (emails.length === 0) {
      emailList.innerHTML = '<div class="empty-state">No emails found</div>';
      return;
    }
    
    emails.forEach(email => {
      const emailElement = document.createElement('div');
      emailElement.className = 'email' + (email.unread ? ' unread' : '');
      emailElement.innerHTML = `
        <div class="email-header">
          <span class="email-sender">${email.from}</span>
          <span class="email-date">${formatDate(email.date)}</span>
        </div>
        <div class="email-subject">${email.subject}</div>
        <div class="email-preview">${email.body.substring(0, 100)}...</div>
      `;
      
      emailElement.addEventListener('click', function() {
        showEmail(email);
      });
      
      emailList.appendChild(emailElement);
    });
  }
  
  function showEmail(email) {
    document.querySelector('.mail-list').style.display = 'none';
    emailView.style.display = 'block';
    
    emailView.innerHTML = `
      <div class="email-view-header">
        <h3>${email.subject}</h3>
        <div class="email-meta">
          <span><i class="fas fa-user"></i> From: ${email.from}</span>
          <span><i class="fas fa-clock"></i> ${formatDate(email.date, true)}</span>
        </div>
        ${email.replyTo ? `<div class="email-meta"><span><i class="fas fa-reply"></i> Reply-To: ${email.replyTo}</span></div>` : ''}
        ${email.cc ? `<div class="email-meta"><span><i class="fas fa-copy"></i> CC: ${email.cc}</span></div>` : ''}
        ${email.bcc ? `<div class="email-meta"><span><i class="fas fa-eye-slash"></i> BCC: ${email.bcc}</span></div>` : ''}
      </div>
      <div class="email-view-body">
        ${email.html ? email.html : `<p>${email.body.replace(/\n/g, '<br>')}</p>`}
      </div>
      <div class="email-actions">
        <button class="reply-btn"><i class="fas fa-reply"></i> Reply</button>
        <button class="reply-all-btn"><i class="fas fa-reply-all"></i> Reply All</button>
        <button class="forward-btn"><i class="fas fa-share"></i> Forward</button>
        <button class="back-btn"><i class="fas fa-arrow-left"></i> Back to Inbox</button>
      </div>
    `;
    
    emailView.querySelector('.reply-btn').addEventListener('click', () => {
      composeModal.style.display = 'block';
      document.getElementById('from').value = email.replyTo || 'your-email@company.com';
      document.getElementById('to').value = email.from;
      document.getElementById('subject').value = `Re: ${email.subject}`;
      document.getElementById('body').value = `\n\n-------- Original Message --------\nFrom: ${email.from}\nDate: ${formatDate(email.date, true)}\nSubject: ${email.subject}\n\n${email.body}`;
    });
    
    emailView.querySelector('.back-btn').addEventListener('click', () => {
      document.querySelector('.mail-list').style.display = 'block';
      emailView.style.display = 'none';
    });
  }
  
  function formatDate(dateString, includeTime = false) {
    const date = new Date(dateString);
    if (includeTime) {
      return date.toLocaleString();
    }
    return date.toLocaleDateString();
  }
});

  // Enhanced showNotification function
  function showNotification(message, type) {
    // Remove any existing notifications first
    const existingNotifications = document.querySelectorAll('.notification');
    existingNotifications.forEach(notification => {
      notification.remove();
    });
    
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Force reflow to enable transition
    void notification.offsetWidth;
    
    notification.classList.add('show');
    
    setTimeout(() => {
      notification.classList.remove('show');
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 3000);
  };