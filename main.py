from flask import Flask, request, jsonify
from flask_cors import CORS
from openpyxl import load_workbook
from openpyxl.drawing.image import Image as XLImage
import imagehash
from PIL import Image
import io
import base64
import os

app = Flask(__name__)
CORS(app)  # Permitir requests desde el frontend

@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok", "message": "API funcionando correctamente"})

@app.route('/process-catalogs', methods=['POST'])
def process_catalogs():
    try:
        if 'files' not in request.files:
            return jsonify({"error": "No se enviaron archivos"}), 400
        
        files = request.files.getlist('files')
        all_products = []
        
        # Procesar cada archivo Excel
        for file in files:
            provider_name = file.filename.replace('.xlsx', '').replace('.xls', '')
            
            # Leer Excel
            wb = load_workbook(file, data_only=True)
            ws = wb.active
            
            # Extraer imágenes embebidas
            images_dict = {}
            if hasattr(ws, '_images'):
                for img in ws._images:
                    # Obtener la fila de la imagen
                    row = img.anchor._from.row if hasattr(img.anchor, '_from') else 0
                    try:
                        img_bytes = img._data()
                        img_pil = Image.open(io.BytesIO(img_bytes))
                        
                        # Calcular hash perceptual
                        phash = str(imagehash.phash(img_pil))
                        avg_hash = str(imagehash.average_hash(img_pil))
                        
                        # Convertir a base64 para enviar al frontend
                        buffered = io.BytesIO()
                        img_pil.save(buffered, format="PNG")
                        img_base64 = base64.b64encode(buffered.getvalue()).decode()
                        
                        images_dict[row] = {
                            'data': img_base64,
                            'phash': phash,
                            'avg_hash': avg_hash
                        }
                    except Exception as e:
                        print(f"Error procesando imagen en fila {row}: {e}")
            
            # Leer datos de las filas
            headers = []
            for cell in ws[1]:
                headers.append(cell.value.strip().upper() if cell.value else '')
            
            # Mapear columnas
            col_map = {}
            for idx, header in enumerate(headers):
                if header in ['CODIGO', 'SKU']:
                    col_map['sku'] = idx
                elif header in ['DESCRIPCION', 'PRODUCTO', 'DESCRIPCIÓN']:
                    col_map['descripcion'] = idx
                elif header in ['PRECIO_CAJA', 'PRECIO']:
                    col_map['precio_caja'] = idx
                elif header in ['PRECIO_MENUDEO', 'MENUDEO']:
                    col_map['precio_menudeo'] = idx
                elif header in ['MOQ', 'PZAS_CAJA']:
                    col_map['moq'] = idx
                elif header in ['CATEGORIA', 'CATEGORÍA']:
                    col_map['categoria'] = idx
            
            # Extraer productos
            for row_idx, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
                if not row or not any(row):
                    continue
                
                product = {
                    'provider': provider_name,
                    'sku': row[col_map.get('sku', 0)] if 'sku' in col_map else f'SKU-{row_idx}',
                    'description': row[col_map.get('descripcion', 1)] if 'descripcion' in col_map else 'Sin descripción',
                    'priceCaja': float(row[col_map.get('precio_caja', 2)] or 0) if 'precio_caja' in col_map else 0,
                    'priceMenudeo': float(row[col_map.get('precio_menudeo', 3)] or 0) if 'precio_menudeo' in col_map else 0,
                    'moq': int(row[col_map.get('moq', 4)] or 100) if 'moq' in col_map else 100,
                    'category': row[col_map.get('categoria', 5)] if 'categoria' in col_map else 'SIN CATEGORIA',
                }
                
                # Buscar imagen para esta fila
                img_data = images_dict.get(row_idx, images_dict.get(row_idx - 1, None))
                if img_data:
                    product['image'] = img_data['data']
                    product['phash'] = img_data['phash']
                    product['avg_hash'] = img_data['avg_hash']
                else:
                    product['image'] = None
                    product['phash'] = None
                    product['avg_hash'] = None
                
                if product['description'] and product['description'] != 'Sin descripción':
                    all_products.append(product)
        
        # Agrupar duplicados usando imagen
        groups = []
        processed = set()
        
        for i, product in enumerate(all_products):
            if i in processed:
                continue
            
            group = [product]
            processed.add(i)
            
            for j, other in enumerate(all_products):
                if i == j or j in processed:
                    continue
                
                # Comparar por hash de imagen (si existen)
                if product.get('phash') and other.get('phash'):
                    # Calcular distancia Hamming
                    phash_dist = sum(c1 != c2 for c1, c2 in zip(product['phash'], other['phash']))
                    avg_dist = sum(c1 != c2 for c1, c2 in zip(product['avg_hash'], other['avg_hash']))
                    
                    # Si las imágenes son muy similares (distancia < 8)
                    if phash_dist < 8 or avg_dist < 8:
                        group.append(other)
                        processed.add(j)
                # Si no hay imagen, comparar por descripción
                elif product['description'].lower() == other['description'].lower():
                    group.append(other)
                    processed.add(j)
            
            groups.append(group)
        
        # Consolidar grupos
        consolidated = []
        for idx, group in enumerate(groups):
            best_price = min(group, key=lambda x: x['priceCaja'])
            best_moq = min(group, key=lambda x: x['moq'])
            best_desc = max(group, key=lambda x: len(x['description']))
            best_img = max(group, key=lambda x: len(x.get('image', '')) if x.get('image') else 0)
            
            prices = [p['priceCaja'] for p in group]
            max_price = max(prices)
            savings = max_price - best_price['priceCaja']
            
            consolidated_product = {
                'consolidated_sku': f'CONS-{str(idx+1).zfill(4)}',
                'description': best_desc['description'],
                'priceCaja': best_price['priceCaja'],
                'priceMenudeo': best_price['priceMenudeo'],
                'moq': best_moq['moq'],
                'category': best_desc['category'],
                'provider': best_price['provider'],
                'num_providers': len(group),
                'savings': round(savings, 2),
                'savingsPercent': round((savings / max_price * 100) if max_price > 0 else 0, 1),
                'image': best_img.get('image'),
                'alternatives': [
                    {
                        'provider': p['provider'],
                        'sku': p['sku'],
                        'priceCaja': p['priceCaja']
                    }
                    for p in sorted(group, key=lambda x: x['priceCaja'])
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
        
        return jsonify({
            'success': True,
            'consolidated': consolidated,
            'stats': stats
        })
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=True)
