from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from PIL import Image
import imagehash
import io
import re
import fitz  # PyMuPDF
import pytesseract
from collections import defaultdict

app = Flask(__name__)
CORS(app)

# Función para extraer imágenes y texto de PDF
def extract_from_pdf(pdf_file):
    """
    Extrae imágenes y texto de un PDF
    Retorna lista de productos con imágenes
    """
    products = []
    
    # Abrir PDF
    pdf_document = fitz.open(stream=pdf_file.read(), filetype="pdf")
    
    for page_num in range(len(pdf_document)):
        page = pdf_document[page_num]
        
        # Extraer texto de la página
        text = page.get_text()
        
        # Extraer imágenes de la página
        image_list = page.get_images(full=True)
        
        print(f"📄 Página {page_num + 1}: {len(image_list)} imágenes encontradas")
        
        for img_index, img in enumerate(image_list):
            try:
                xref = img[0]
                base_image = pdf_document.extract_image(xref)
                image_bytes = base_image["image"]
                
                # Convertir a PIL Image
                image = Image.open(io.BytesIO(image_bytes))
                
                # Calcular hash de la imagen
                img_hash = str(imagehash.phash(image))
                
                # Intentar extraer info del texto cercano
                # Buscar patrones comunes en catálogos
                
                # Patrón para SKU (ejemplos: SKU123, ABC-123, 12345)
                sku_pattern = r'(?:SKU[:\s]*)?([A-Z0-9\-]{4,15})'
                
                # Patrón para precios (ejemplos: $123.45, $123, 123.45)
                price_pattern = r'\$?\s*(\d+\.?\d{0,2})'
                
                # Patrón para descripción (texto antes del precio generalmente)
                lines = text.split('\n')
                
                # Buscar datos en el contexto de la imagen
                sku = f"PDF-{page_num+1}-{img_index+1}"
                description = f"Producto {page_num+1}-{img_index+1}"
                prices = []
                
                for line in lines:
                    line = line.strip()
                    if not line:
                        continue
                    
                    # Buscar SKUs
                    sku_match = re.search(sku_pattern, line, re.IGNORECASE)
                    if sku_match and len(sku) < 10:  # Solo si aún no tenemos un SKU bueno
                        sku = sku_match.group(1)
                    
                    # Buscar precios
                    price_matches = re.findall(price_pattern, line)
                    for match in price_matches:
                        try:
                            price = float(match)
                            if 1 <= price <= 10000:  # Filtrar precios razonables
                                prices.append(price)
                        except:
                            pass
                    
                    # Si la línea tiene 20-100 caracteres, podría ser descripción
                    if 20 <= len(line) <= 100 and not any(c in line for c in ['$', '€', '£']):
                        description = line[:80]  # Limitar longitud
                
                # Si no encontramos precios, intentar OCR en la imagen
                if not prices:
                    try:
                        ocr_text = pytesseract.image_to_string(image, lang='spa')
                        ocr_prices = re.findall(price_pattern, ocr_text)
                        for match in ocr_prices:
                            try:
                                price = float(match)
                                if 1 <= price <= 10000:
                                    prices.append(price)
                            except:
                                pass
                    except Exception as e:
                        print(f"⚠️ OCR error: {e}")
                
                # Usar el precio más bajo como precio de menudeo, siguiente como caja
                price_menudeo = min(prices) if prices else 50.00
                price_caja = prices[1] if len(prices) > 1 else price_menudeo * 0.8
                
                product = {
                    'sku': sku,
                    'description': description,
                    'priceMenudeo': round(price_menudeo, 2),
                    'priceCaja': round(price_caja, 2),
                    'moq': 100,  # Default
                    'category': 'GENERAL',  # Default
                    'image_hash': img_hash,
                    'image': image
                }
                
                products.append(product)
                print(f"✓ Producto extraído: {sku} - ${price_menudeo}")
                
            except Exception as e:
                print(f"❌ Error extrayendo imagen {img_index}: {e}")
                continue
    
    pdf_document.close()
    return products

# Función para procesar archivos Excel (mantener compatibilidad)
def extract_from_excel(excel_file):
    """
    Mantiene la funcionalidad original de Excel
    """
    from openpyxl import load_workbook
    from openpyxl.drawing.image import Image as XLImage
    
    products = []
    
    try:
        wb = load_workbook(excel_file, data_only=True)
        sheet = wb.active
        
        # Detectar columnas
        headers = [cell.value for cell in sheet[1]]
        
        col_mapping = {}
        for idx, header in enumerate(headers, 1):
            if header:
                h = str(header).lower()
                if 'sku' in h or 'codigo' in h:
                    col_mapping['sku'] = idx
                elif 'descripcion' in h or 'producto' in h or 'nombre' in h:
                    col_mapping['description'] = idx
                elif 'menudeo' in h or 'precio' in h:
                    col_mapping['price'] = idx
                elif 'caja' in h or 'mayoreo' in h:
                    col_mapping['priceCaja'] = idx
                elif 'moq' in h or 'minimo' in h:
                    col_mapping['moq'] = idx
                elif 'categoria' in h or 'category' in h:
                    col_mapping['category'] = idx
        
        # Extraer imágenes
        for image in sheet._images:
            try:
                row = image.anchor._from.row + 1
                
                # Leer datos de la fila
                sku = sheet.cell(row, col_mapping.get('sku', 1)).value or f"XLS-{row}"
                description = sheet.cell(row, col_mapping.get('description', 2)).value or "Producto sin descripción"
                price = sheet.cell(row, col_mapping.get('price', 3)).value or 50.00
                price_caja = sheet.cell(row, col_mapping.get('priceCaja', 4)).value or price * 0.8
                moq = sheet.cell(row, col_mapping.get('moq', 5)).value or 100
                category = sheet.cell(row, col_mapping.get('category', 6)).value or "GENERAL"
                
                # Convertir imagen
                img_bytes = image._data()
                img = Image.open(io.BytesIO(img_bytes))
                img_hash = str(imagehash.phash(img))
                
                product = {
                    'sku': str(sku),
                    'description': str(description),
                    'priceMenudeo': float(price),
                    'priceCaja': float(price_caja),
                    'moq': int(moq),
                    'category': str(category),
                    'image_hash': img_hash,
                    'image': img
                }
                
                products.append(product)
                print(f"✓ Excel: {sku} - ${price}")
                
            except Exception as e:
                print(f"❌ Error en imagen Excel: {e}")
                continue
        
        wb.close()
        
    except Exception as e:
        print(f"❌ Error leyendo Excel: {e}")
    
    return products

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'message': 'API funcionando correctamente'}), 200

@app.route('/api/consolidate', methods=['POST'])
def consolidate_catalogs():
    try:
        if 'files' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No se enviaron archivos'
            }), 400
        
        files = request.files.getlist('files')
        
        if not files:
            return jsonify({
                'success': False,
                'error': 'Lista de archivos vacía'
            }), 400
        
        print(f"📦 Recibidos {len(files)} archivos")
        
        all_products = []
        
        # Procesar cada archivo
        for file in files:
            filename = file.filename.lower()
            provider_name = file.filename.split('.')[0]
            
            print(f"📄 Procesando: {file.filename}")
            
            if filename.endswith('.pdf'):
                # Procesar PDF
                products = extract_from_pdf(file)
            elif filename.endswith(('.xlsx', '.xls')):
                # Procesar Excel
                products = extract_from_excel(file)
            else:
                print(f"⚠️ Formato no soportado: {filename}")
                continue
            
            # Añadir nombre de proveedor
            for product in products:
                product['provider'] = provider_name
            
            all_products.extend(products)
            print(f"✓ {len(products)} productos de {provider_name}")
        
        if not all_products:
            return jsonify({
                'success': False,
                'error': 'No se pudieron extraer productos de los archivos'
            }), 400
        
        print(f"📊 Total productos: {len(all_products)}")
        
        # Agrupar productos similares por hash de imagen
        groups = defaultdict(list)
        for product in all_products:
            groups[product['image_hash']].append(product)
        
        print(f"🔗 Grupos formados: {len(groups)}")
        
        # Consolidar: elegir el mejor precio de cada grupo
        consolidated = []
        for hash_key, group in groups.items():
            # Ordenar por precio de caja (menor precio primero)
            group_sorted = sorted(group, key=lambda x: x['priceCaja'])
            best = group_sorted[0]
            
            # Calcular ahorro
            prices = [p['priceCaja'] for p in group]
            max_price = max(prices)
            savings = round(max_price - best['priceCaja'], 2)
            
            consolidated_product = {
                'consolidated_sku': f"CONS-{str(len(consolidated) + 1).zfill(4)}",
                'description': best['description'],
                'priceMenudeo': best['priceMenudeo'],
                'priceCaja': best['priceCaja'],
                'moq': best['moq'],
                'category': best['category'],
                'provider': best['provider'],
                'num_providers': len(group),
                'savings': savings,
                'alternatives': [
                    {
                        'provider': p['provider'],
                        'sku': p['sku'],
                        'priceCaja': p['priceCaja']
                    }
                    for p in group
                ]
            }
            
            consolidated.append(consolidated_product)
        
        # Ordenar por categoría
        consolidated.sort(key=lambda x: x['category'])
        
        # Calcular estadísticas
        stats = {
            'totalProducts': len(consolidated),
            'totalSavings': round(sum(p['savings'] for p in consolidated), 2),
            'duplicateProducts': len([p for p in consolidated if p['num_providers'] > 1]),
            'avgProviders': round(sum(p['num_providers'] for p in consolidated) / len(consolidated), 1) if consolidated else 0
        }
        
        print(f"✅ Consolidación completa: {stats['totalProducts']} productos únicos")
        
        return jsonify({
            'success': True,
            'consolidated': consolidated,
            'stats': stats
        })
        
    except Exception as e:
        print(f"❌ Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
