from flask import Flask, request, jsonify
from flask_cors import CORS
import os
from PIL import Image
import imagehash
import io
import re
import fitz  # PyMuPDF
from collections import defaultdict
import gc  # Garbage collector

app = Flask(__name__)
CORS(app)

# Configuración para optimizar memoria
MAX_IMAGE_SIZE = (800, 800)  # Reducir imágenes a máximo 800x800px
HASH_SIZE = 8  # Tamaño del hash perceptual

def resize_image(image, max_size=MAX_IMAGE_SIZE):
    """
    Redimensiona imagen manteniendo aspect ratio
    Reduce significativamente el uso de memoria
    """
    image.thumbnail(max_size, Image.Resampling.LANCZOS)
    return image

def extract_from_pdf(pdf_file):
    """
    Extrae imágenes y texto de un PDF de forma optimizada
    """
    products = []
    pdf_document = None
    
    try:
        # Leer el PDF en memoria
        pdf_bytes = pdf_file.read()
        pdf_document = fitz.open(stream=pdf_bytes, filetype="pdf")
        
        total_pages = len(pdf_document)
        print(f"📄 PDF con {total_pages} páginas")
        
        for page_num in range(total_pages):
            page = pdf_document[page_num]
            
            # Extraer texto de la página
            text = page.get_text()
            
            # Extraer imágenes de la página
            image_list = page.get_images(full=True)
            
            print(f"📄 Página {page_num + 1}/{total_pages}: {len(image_list)} imágenes")
            
            if not image_list:
                continue
            
            # Dividir texto en líneas
            lines = [l.strip() for l in text.split('\n') if l.strip()]
            
            for img_index, img in enumerate(image_list):
                try:
                    xref = img[0]
                    base_image = pdf_document.extract_image(xref)
                    image_bytes = base_image["image"]
                    
                    # Convertir a PIL Image
                    image = Image.open(io.BytesIO(image_bytes))
                    
                    # **OPTIMIZACIÓN 1: Reducir tamaño de imagen**
                    image = resize_image(image)
                    
                    # **OPTIMIZACIÓN 2: Convertir a RGB si es necesario**
                    if image.mode not in ('RGB', 'L'):
                        image = image.convert('RGB')
                    
                    # Calcular hash de la imagen
                    img_hash = str(imagehash.phash(image, hash_size=HASH_SIZE))
                    
                    # BUSCAR DATOS EN EL TEXTO
                    sku_pattern = r'(?:SKU[:\s]*)?([A-Z0-9\-]{3,20})'
                    price_pattern = r'\$?\s*(\d{1,5}\.?\d{0,2})'
                    
                    sku = f"PDF-{page_num+1}-{img_index+1}"
                    description = "Producto sin descripción"
                    prices = []
                    
                    # Buscar en las primeras 50 líneas (optimizar)
                    for i, line in enumerate(lines[:50]):
                        sku_matches = re.findall(sku_pattern, line, re.IGNORECASE)
                        if sku_matches:
                            for match in sku_matches:
                                if 4 <= len(match) <= 15:
                                    sku = match
                                    break
                        
                        price_matches = re.findall(price_pattern, line)
                        for match in price_matches:
                            try:
                                price = float(match.replace(',', ''))
                                if 1 <= price <= 10000:
                                    prices.append(price)
                            except:
                                pass
                        
                        if 15 <= len(line) <= 100:
                            if not any(c in line for c in ['$', '€', '£', '¢']):
                                if not line.replace('-', '').replace(' ', '').isdigit():
                                    description = line[:80]
                    
                    # Asignar precios
                    if prices:
                        prices_sorted = sorted(set(prices))
                        price_menudeo = prices_sorted[0]
                        price_caja = prices_sorted[1] if len(prices_sorted) > 1 else price_menudeo * 0.85
                    else:
                        price_menudeo = 50.00
                        price_caja = 42.50
                    
                    # Detectar categoría
                    category = 'GENERAL'
                    text_lower = text.lower()
                    if any(word in text_lower for word in ['electronic', 'electrónic', 'gadget', 'usb', 'cable']):
                        category = 'ELECTRONICA'
                    elif any(word in text_lower for word in ['accesorio', 'accessory', 'soporte', 'funda']):
                        category = 'ACCESORIOS'
                    elif any(word in text_lower for word in ['hogar', 'home', 'cocina', 'kitchen']):
                        category = 'HOGAR'
                    elif any(word in text_lower for word in ['deporte', 'sport', 'fitness', 'ejercicio']):
                        category = 'DEPORTES'
                    
                    product = {
                        'sku': sku,
                        'description': description,
                        'priceMenudeo': round(price_menudeo, 2),
                        'priceCaja': round(price_caja, 2),
                        'moq': 100,
                        'category': category,
                        'image_hash': img_hash,
                    }
                    
                    products.append(product)
                    
                    # **OPTIMIZACIÓN 3: Limpiar imagen de memoria**
                    del image
                    del image_bytes
                    
                except Exception as e:
                    print(f"❌ Error en imagen {img_index}: {e}")
                    continue
            
            # **OPTIMIZACIÓN 4: Liberar memoria después de cada página**
            del page
            if page_num % 5 == 0:  # Cada 5 páginas
                gc.collect()
        
    except Exception as e:
        print(f"❌ Error leyendo PDF: {e}")
    finally:
        if pdf_document:
            pdf_document.close()
        # **OPTIMIZACIÓN 5: Forzar garbage collection**
        gc.collect()
    
    print(f"📦 Total productos del PDF: {len(products)}")
    return products

def extract_from_excel(excel_file):
    """
    Procesar Excel de forma optimizada
    """
    from openpyxl import load_workbook
    
    products = []
    wb = None
    
    try:
        wb = load_workbook(excel_file, data_only=True)
        sheet = wb.active
        
        # Detectar columnas
        headers = [cell.value for cell in sheet[1]]
        
        col_mapping = {}
        for idx, header in enumerate(headers, 1):
            if header:
                h = str(header).lower()
                if 'sku' in h or 'codigo' in h or 'clave' in h:
                    col_mapping['sku'] = idx
                elif 'descripcion' in h or 'producto' in h or 'nombre' in h or 'description' in h:
                    col_mapping['description'] = idx
                elif 'menudeo' in h or 'retail' in h:
                    col_mapping['price'] = idx
                elif 'precio' in h and 'price' not in col_mapping:
                    col_mapping['price'] = idx
                elif 'caja' in h or 'mayoreo' in h or 'wholesale' in h:
                    col_mapping['priceCaja'] = idx
                elif 'moq' in h or 'minimo' in h or 'minimum' in h:
                    col_mapping['moq'] = idx
                elif 'categoria' in h or 'category' in h:
                    col_mapping['category'] = idx
        
        print(f"📊 Columnas detectadas: {col_mapping}")
        
        # Extraer imágenes
        for image in sheet._images:
            try:
                row = image.anchor._from.row + 1
                
                # Leer datos de la fila
                sku = sheet.cell(row, col_mapping.get('sku', 1)).value or f"XLS-{row}"
                description = sheet.cell(row, col_mapping.get('description', 2)).value or "Producto sin descripción"
                price = sheet.cell(row, col_mapping.get('price', 3)).value or 50.00
                price_caja = sheet.cell(row, col_mapping.get('priceCaja', 4)).value
                
                if not price_caja:
                    price_caja = float(price) * 0.85
                
                moq = sheet.cell(row, col_mapping.get('moq', 5)).value or 100
                category = sheet.cell(row, col_mapping.get('category', 6)).value or "GENERAL"
                
                # Convertir imagen
                img_bytes = image._data()
                img = Image.open(io.BytesIO(img_bytes))
                
                # **OPTIMIZACIÓN: Reducir tamaño**
                img = resize_image(img)
                
                if img.mode not in ('RGB', 'L'):
                    img = img.convert('RGB')
                
                img_hash = str(imagehash.phash(img, hash_size=HASH_SIZE))
                
                product = {
                    'sku': str(sku),
                    'description': str(description),
                    'priceMenudeo': float(price),
                    'priceCaja': float(price_caja),
                    'moq': int(moq),
                    'category': str(category),
                    'image_hash': img_hash,
                }
                
                products.append(product)
                
                # Limpiar
                del img
                del img_bytes
                
            except Exception as e:
                print(f"❌ Error en fila {row}: {e}")
                continue
        
    except Exception as e:
        print(f"❌ Error leyendo Excel: {e}")
    finally:
        if wb:
            wb.close()
        gc.collect()
    
    print(f"📦 Total productos del Excel: {len(products)}")
    return products

@app.route('/health', methods=['GET'])
def health():
    return jsonify({'status': 'healthy', 'message': 'API optimizada - PDF y Excel'}), 200

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
        
        # **OPTIMIZACIÓN 6: Procesar archivo por archivo y limpiar memoria**
        for idx, file in enumerate(files):
            filename = file.filename.lower()
            provider_name = file.filename.split('.')[0]
            
            print(f"📄 Procesando archivo {idx+1}/{len(files)}: {file.filename}")
            
            try:
                if filename.endswith('.pdf'):
                    products = extract_from_pdf(file)
                elif filename.endswith(('.xlsx', '.xls')):
                    products = extract_from_excel(file)
                else:
                    print(f"⚠️ Formato no soportado: {filename}")
                    continue
                
                # Añadir nombre de proveedor
                for product in products:
                    product['provider'] = provider_name
                
                all_products.extend(products)
                print(f"✓ {len(products)} productos de {provider_name}")
                
                # **OPTIMIZACIÓN 7: Limpiar después de cada archivo**
                del products
                gc.collect()
                
            except Exception as e:
                print(f"❌ Error procesando {file.filename}: {e}")
                continue
        
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
            group_sorted = sorted(group, key=lambda x: x['priceCaja'])
            best = group_sorted[0]
            
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
        
        # Limpiar grupos de memoria
        del groups
        del all_products
        gc.collect()
        
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
    finally:
        # **OPTIMIZACIÓN 8: Siempre limpiar al final**
        gc.collect()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
