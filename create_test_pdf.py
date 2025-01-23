from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter

def create_test_pdf():
    c = canvas.Canvas('test.pdf', pagesize=letter)
    
    # Add a title
    c.setFont("Helvetica-Bold", 16)
    c.drawString(100, 750, 'Test PDF Document')
    
    # Add some paragraphs of text
    c.setFont("Helvetica", 12)
    c.drawString(100, 720, 'This is a test PDF file created for testing the PDF analysis functionality.')
    c.drawString(100, 700, 'The document contains specific information that we can test with questions:')
    
    # Add some specific facts we can test
    facts = [
        'The capital of France is Paris.',
        'The speed of light is approximately 299,792 kilometers per second.',
        'Water freezes at 0 degrees Celsius.',
        'The Earth completes one rotation around its axis in 24 hours.',
        'The human body has 206 bones.'
    ]
    
    y_position = 670
    for fact in facts:
        c.drawString(120, y_position, '• ' + fact)
        y_position -= 20
    
    # Add a section about testing PDF lookup
    c.setFont("Helvetica-Bold", 14)
    c.drawString(100, y_position - 20, 'Testing Section')
    
    c.setFont("Helvetica", 12)
    y_position -= 40
    c.drawString(100, y_position, 'This section contains a unique identifier: TEST-ID-12345')
    
    # Save the PDF
    c.save()

if __name__ == '__main__':
    create_test_pdf()
